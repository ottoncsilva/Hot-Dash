/**
 * Catálogo dos tipos de alerta que o app pode disparar no celular.
 *
 * Fica separado de settings.ts (que é server-only) porque a tela de
 * Configurações precisa dos rótulos para montar a lista de opções.
 * Para adicionar um alerta novo: inclua aqui e chame sendPushEvent(<id>, ...)
 * no ponto que dispara — a preferência passa a valer sozinha.
 */

export type PushEventType = "sale" | "pix" | "scheduleReminder" | "telegramPost" | "mailing";

export type PushEventDef = {
  id: PushEventType;
  label: string;
  description: string;
  /** Ligado para quem nunca mexeu nas preferências. */
  defaultOn: boolean;
};

export const PUSH_EVENTS: PushEventDef[] = [
  {
    id: "sale",
    label: "Vendas",
    description:
      "Pagamento confirmado, com o valor e o produto. Vale também para checkout externo.",
    defaultOn: true,
  },
  {
    id: "pix",
    label: "Pix gerados",
    description:
      "Toda vez que um Pix é gerado e fica aguardando pagamento — pelo painel ou pelo bot de vendas.",
    defaultOn: true,
  },
  {
    id: "scheduleReminder",
    label: "Postagem do cronograma",
    description:
      "15 minutos antes de um post agendado no Cronograma, para você publicar na mão.",
    defaultOn: true,
  },
  {
    id: "telegramPost",
    label: "Postagem do Telegram",
    description:
      "Quando a automação publica no VIP ou nas Prévias. Avisa também se algum envio falhar.",
    defaultOn: false,
  },
  {
    id: "mailing",
    label: "Mailing",
    description:
      "Ao terminar um disparo em massa, com quantas mensagens saíram, falharam e quantos bloquearam o bot.",
    defaultOn: true,
  },
];

export type NotificationPrefs = Record<PushEventType, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = PUSH_EVENTS.reduce(
  (acc, e) => ({ ...acc, [e.id]: e.defaultOn }),
  {} as NotificationPrefs,
);

/** Completa o que estiver faltando/ inválido com o padrão de cada tipo. */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return PUSH_EVENTS.reduce((acc, e) => {
    acc[e.id] = typeof obj[e.id] === "boolean" ? (obj[e.id] as boolean) : e.defaultOn;
    return acc;
  }, {} as NotificationPrefs);
}
