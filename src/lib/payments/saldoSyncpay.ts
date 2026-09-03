import "server-only";
import { activeProvider } from "@/lib/payments";

/**
 * O saldo na SyncPay, com a memória de quando ele foi lido.
 *
 * Mora aqui, e não dentro da rota, porque quem precisa dele deixou de ser só a
 * tela: venda aprovada e saque também mandam buscar (ver
 * `atualizarSaldoAposMovimento`), e dois caches para o mesmo número
 * divergiriam no primeiro dia.
 *
 * A rota de saldo da SyncPay é limitada — ela responde 429 quando se insiste —,
 * então toda leitura passa pelos dois freios abaixo.
 */

/** Idade a partir da qual uma leitura comum vale a pena refazer. */
const TTL_MS = 60_000;

/**
 * Piso entre duas consultas de VERDADE, valendo até para quem pede `force`.
 * Recarregar o Dashboard três vezes seguidas, ou três vendas caindo no mesmo
 * minuto, não podem virar três chamadas — a SyncPay corta por excesso e o
 * card fica sem número justamente na hora movimentada.
 */
const MIN_MS = 15_000;

/**
 * Espera antes de consultar depois de um movimento. O webhook chega no instante
 * da aprovação (ou do saque), e o dinheiro entra ou sai do saldo um pouco
 * depois: perguntar no mesmo milissegundo devolveria o valor de ANTES — e ele
 * ficaria guardado como se fosse o de agora.
 *
 * Cinco segundos é a mesma espera que o aviso de venda no celular já usa
 * (`sendPushEventAoVivo`), pelo mesmo motivo: dar tempo ao gateway.
 */
const ESPERA_POS_MOVIMENTO_MS = 5_000;

let cache: { at: number; cents: number | null } | null = null;

export type LeituraSaldo = {
  connected: boolean;
  balanceCents: number | null;
  at: number | null;
  cached?: boolean;
  /** Valor antigo, devolvido porque a consulta de agora falhou. */
  stale?: boolean;
  reason?: string;
};

export async function lerSaldoSyncpay(force = false): Promise<LeituraSaldo> {
  const provider = activeProvider();
  if (!provider?.getBalance) return { connected: false, balanceCents: null, at: null };

  const idade = cache ? Date.now() - cache.at : Infinity;
  if (cache && (idade < MIN_MS || (!force && idade < TTL_MS))) {
    return { connected: true, balanceCents: cache.cents, at: cache.at, cached: true };
  }

  // Usa o caminho com diagnóstico quando existe: é a MESMA chamada HTTP, mas
  // volta com o motivo da falha — assim o card não fica só dizendo
  // "indisponível" sem explicar.
  let cents: number | null = null;
  let reason: string | undefined;
  if (provider.diagnoseBalance) {
    const d = await provider.diagnoseBalance().catch(() => null);
    cents = d?.cents ?? null;
    const ultima = d?.attempts?.[d.attempts.length - 1];
    if (cents === null) {
      reason =
        ultima?.error ||
        (ultima?.httpStatus ? `gateway respondeu ${ultima.httpStatus}` : "sem resposta do gateway");
    }
  } else {
    const bal = await provider.getBalance().catch(() => null);
    cents = bal?.availableCents ?? null;
  }

  if (cents !== null) {
    cache = { at: Date.now(), cents };
    return { connected: true, balanceCents: cents, at: cache.at };
  }
  // Consulta falhou: devolve o último valor conhecido, se houver, junto do
  // motivo — quem não tem valor nenhum ainda pelo menos sabe o porquê.
  return {
    connected: true,
    balanceCents: cache?.cents ?? null,
    at: cache?.at ?? null,
    stale: Boolean(cache),
    reason,
  };
}

/**
 * MEXEU NO DINHEIRO na SyncPay: busca o saldo de novo.
 *
 * Vale para os dois lados. Venda aprovada credita; SAQUE debita — e o saque
 * era o único movimento que o painel via passar e ignorava por inteiro, então
 * o card seguia mostrando o valor de antes dele. Nenhum dos dois vira
 * transação por aqui: isto só marca que o número guardado envelheceu.
 *
 * Antes, o saldo só era consultado quando alguém ABRIA o Dashboard. Com o
 * painel aberto e parado, ou fechado, o movimento passava e o número
 * continuava o de antes até a próxima visita.
 *
 * Não espera nem lança: é chamada de dentro do webhook, e o gateway não pode
 * ficar segurando a resposta — nem receber erro — por causa de uma consulta de
 * saldo que é só informativa.
 */
export function atualizarSaldoAposMovimento(): void {
  setTimeout(() => {
    lerSaldoSyncpay(true).catch(() => {});
  }, ESPERA_POS_MOVIMENTO_MS).unref?.();
}
