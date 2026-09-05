import { NETWORK_LABELS, type MediaItem, type Profile } from "./types";

/**
 * ONDE uma mídia pode ter sido publicada, do ponto de vista da tela.
 *
 * Uma lista só, misturando os dois grupos do Telegram e as contas de rede
 * social, porque para quem está marcando "já postei isto" a pergunta é uma:
 * onde? A diferença entre um grupo e uma conta é do banco (ver
 * `lib/mediaUsage.ts`), não de quem opera.
 *
 * `key` é o que identifica o destino na tela e no que volta do servidor:
 * `previas`/`vip` para os grupos, o id da conta para as redes.
 */
export type DestinoPublicacao = {
  key: string;
  label: string;
  /** O `audience` do log: "previas", "vip" ou o nome da rede. */
  destino: string;
  accountId?: string;
};

/**
 * Os destinos da modelo.
 *
 * Prévias e VIP só aparecem quando ela TEM Telegram cadastrado: numa modelo
 * que só posta no Instagram eles seriam duas opções que não querem dizer nada.
 * As contas inativas ficam de fora pelo mesmo motivo do Cronograma — conta
 * desligada não recebe post novo —, mas o histórico dela continua contando.
 */
export function destinosDaModelo(profile?: Profile | null): DestinoPublicacao[] {
  if (!profile) return [];
  const lista: DestinoPublicacao[] = [];
  if (profile.accounts.some((a) => a.network === "telegram")) {
    lista.push({ key: "previas", label: "Telegram · Prévias", destino: "previas" });
    lista.push({ key: "vip", label: "Telegram · VIP", destino: "vip" });
  }
  for (const a of profile.accounts) {
    if (a.network === "telegram" || !a.active) continue;
    lista.push({
      key: a.id,
      label: `@${a.username.replace(/^@/, "")} · ${NETWORK_LABELS[a.network]}`,
      destino: a.network,
      accountId: a.id,
    });
  }
  return lista;
}

/** Quantas vezes esta mídia já saiu neste destino (marcado à mão ou enviado
 *  de verdade — para a tela é a mesma contagem). */
export function vezesPostadaEm(item: MediaItem, d: DestinoPublicacao): number {
  const c = item.postCounts;
  if (!c) return 0;
  if (d.key === "previas") return c.previas || 0;
  if (d.key === "vip") return c.vip || 0;
  return c.contas?.find((x) => x.accountId === d.accountId)?.times || 0;
}

/**
 * Este destino foi marcado À MÃO nesta mídia?
 *
 * É o que decide se o toque pode DESMARCAR: envio de verdade não se apaga por
 * um toque na galeria — apagar o registro de um post que já está no grupo
 * faria o Método MK reoferecer o que o público já viu.
 */
export function marcadaAMaoEm(item: MediaItem, d: DestinoPublicacao): boolean {
  return Boolean(item.postCounts?.manuais?.includes(d.key));
}
