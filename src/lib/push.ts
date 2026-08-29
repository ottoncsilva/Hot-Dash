import webpush from "web-push";
import { getDb } from "./db";
import { randomUUID } from "crypto";
import type { PushEventType } from "./notificationTypes";

type VapidKeys = {
  publicKey: string;
  privateKey: string;
};

let initialized = false;

function getVapidKeys(): VapidKeys {
  const db = getDb();
  let row = db.prepare("SELECT value FROM settings WHERE key = 'vapid_keys'").get() as { value: string } | undefined;
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare("INSERT INTO settings (key, value) VALUES ('vapid_keys', ?)").run(JSON.stringify(keys));
    return keys;
  }
  return JSON.parse(row.value) as VapidKeys;
}

export function initWebPush() {
  if (initialized) return;
  const keys = getVapidKeys();
  webpush.setVapidDetails(
    "mailto:contato@hotdash.com",
    keys.publicKey,
    keys.privateKey
  );
  initialized = true;
}

export function getVapidPublicKey() {
  return getVapidKeys().publicKey;
}

export function saveSubscription(subscription: any) {
  const db = getDb();
  // Pra evitar duplicação, exclui pela url do endpoint antes (pois o endpoint é único por browser)
  db.prepare("DELETE FROM push_subscriptions WHERE json_extract(subscription_json, '$.endpoint') = ?").run(subscription.endpoint);
  
  db.prepare("INSERT INTO push_subscriptions (id, subscription_json, created_at) VALUES (?, ?, ?)")
    .run(randomUUID(), JSON.stringify(subscription), Date.now());
}

export function removeSubscription(endpoint: string) {
  const db = getDb();
  db.prepare("DELETE FROM push_subscriptions WHERE json_extract(subscription_json, '$.endpoint') = ?").run(endpoint);
}

/**
 * ESPERA ANTES DE DISPARAR. Todo alerta sai 5 segundos depois do evento que o
 * gerou, e o texto é montado NO FIM dessa espera — não no começo.
 *
 * O motivo é uma corrida real: numa venda de bot que o Hot-Dash NÃO opera, o
 * webhook do gateway e o relatório do Canal de Vendas chegam separados, em
 * qualquer ordem. O gateway sabe o valor; só o relatório sabe o produto, a
 * modelo, o cliente e o código de origem. Disparando na hora, o alerta saía
 * com metade da venda — "💰 Venda aprovada — R$ 19,90" e mais nada — e o
 * relatório chegava meio segundo depois, completando uma linha que o celular
 * já tinha mostrado pela metade.
 *
 * 5 segundos é o suficiente para o segundo lado chegar (os dois nascem do
 * MESMO pagamento, com milissegundos de diferença) e curto demais para
 * alguém notar num aviso de celular.
 *
 * ESPERAR SÓ NÃO BASTA: adiar um texto já escrito adia o mesmo texto
 * incompleto. Por isso quem tem dado que pode mudar manda uma FUNÇÃO
 * (`sendPushEventAoVivo`), executada no fim da espera, quando o relatório já
 * entrou no banco.
 */
export const PUSH_DELAY_MS = 5_000;

/**
 * Núcleo dos dois disparos: espera, e só então decide o que (e se) manda.
 *
 * A preferência do operador é conferida NO FIM da espera, de propósito: é o
 * estado no momento de tocar o celular que importa, e desligar o alerta
 * durante a janela deve valer.
 *
 * Não devolve nada e nunca lança: quem chama já seguiu em frente há 5
 * segundos, e uma falha de push não pode aparecer como erro no webhook (o
 * gateway reenviaria em loop).
 */
type MensagemPush = { title: string; body: string; url: string };

function agendarPush(
  type: PushEventType,
  montar: () => MensagemPush | null | Promise<MensagemPush | null>,
): void {
  // Sem `unref()`: um timer de 5s segurando o processo é inofensivo, e soltá-lo
  // faria justamente os alertas de venda sumirem num restart.
  setTimeout(async () => {
    try {
      const { getNotificationPrefs } = await import("./settings");
      if (!getNotificationPrefs()[type]) return;
      const msg = await montar();
      if (!msg) return; // o evento deixou de valer no meio da espera
      await sendPushToAll(msg.title, msg.body, msg.url);
    } catch (err) {
      console.error("[hotdash] falha ao enviar push atrasado:", err);
    }
  }, PUSH_DELAY_MS);
}

/**
 * Envia um alerta de um TIPO específico, respeitando o que o operador escolheu
 * em Configurações → Notificações. Todo disparo automático deve passar por aqui
 * (o `sendPushToAll` cru fica para o botão de teste, que é manual e explícito).
 *
 * Volta na hora: o alerta é AGENDADO (ver `PUSH_DELAY_MS`), não enviado. Quem
 * chama nunca esperou pelo push — o `await` de antes só media o tempo de falar
 * com o servidor de push, e nenhum chamador usava o resultado.
 */
export async function sendPushEvent(
  type: PushEventType,
  title: string,
  body: string,
  url: string,
): Promise<void> {
  agendarPush(type, () => ({ title, body, url }));
}

/**
 * Alerta cujo TEXTO é montado no fim da espera, com o que o banco tiver
 * naquele instante.
 *
 * É o que serve para venda: `montar` relê a transação, e o que o relatório do
 * Canal de Vendas tiver completado nesses 5 segundos (produto, modelo,
 * cliente) já entra no aviso. Devolver `null` cancela o disparo — para o caso
 * de a linha ter sido apagada ou estornada no meio da janela.
 */
export async function sendPushEventAoVivo(
  type: PushEventType,
  montar: () => MensagemPush | null | Promise<MensagemPush | null>,
): Promise<void> {
  agendarPush(type, montar);
}

/** Quantos aparelhos estão inscritos para receber os alertas. */
export function countSubscriptions(): number {
  const r = getDb()
    .prepare("SELECT COUNT(*) c FROM push_subscriptions")
    .get() as { c: number };
  return r.c;
}

export async function sendPushToAll(title: string, body: string, url: string) {
  initWebPush();
  const db = getDb();
  const subs = db.prepare("SELECT id, subscription_json FROM push_subscriptions").all() as { id: string, subscription_json: string }[];
  
  const payload = JSON.stringify({
    title,
    body,
    url
  });

  for (const sub of subs) {
    try {
      const parsed = JSON.parse(sub.subscription_json);
      await webpush.sendNotification(parsed, payload);
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Inscrição expirou ou foi removida pelo usuário
        db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      } else {
        console.error("Erro ao enviar push:", err);
      }
    }
  }
}
