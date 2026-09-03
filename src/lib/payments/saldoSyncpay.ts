import "server-only";
import { activeProvider } from "@/lib/payments";

/**
 * O saldo na SyncPay, com a memória de quando ele foi lido.
 *
 * Mora aqui, e não dentro da rota, porque quem precisa dele deixou de ser só a
 * tela: uma venda aprovada também manda buscar (ver `atualizarSaldoAposVenda`),
 * e dois caches para o mesmo número divergiriam no primeiro dia.
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
 * Espera antes de consultar depois de uma venda. O webhook chega no instante
 * da aprovação, e o dinheiro entra no saldo um pouco depois: perguntar no
 * mesmo milissegundo devolveria o valor de ANTES da venda — e ele ficaria
 * guardado como se fosse o de agora.
 *
 * Cinco segundos é a mesma espera que o aviso de venda no celular já usa
 * (`sendPushEventAoVivo`), pelo mesmo motivo: dar tempo ao gateway.
 */
const ESPERA_POS_VENDA_MS = 5_000;

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
 * VENDA APROVADA na SyncPay: busca o saldo de novo.
 *
 * Antes, o saldo só era consultado quando alguém ABRIA o Dashboard. Com o
 * painel aberto e parado, ou fechado, a venda entrava e o número continuava o
 * de antes até a próxima visita. Agora a própria venda manda atualizar.
 *
 * Não espera nem lança: é chamada de dentro do webhook, e o gateway não pode
 * ficar segurando a resposta — nem receber erro — por causa de uma consulta de
 * saldo que é só informativa.
 */
export function atualizarSaldoAposVenda(): void {
  setTimeout(() => {
    lerSaldoSyncpay(true).catch(() => {});
  }, ESPERA_POS_VENDA_MS).unref?.();
}
