import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";

/**
 * Diário dos webhooks do gateway.
 *
 * A SyncPay cadastra o webhook POR CONTA e manda por ele todo tipo de
 * movimento, mas a documentação só descreve o de venda (cash-in). Quando um
 * saque entrou como venda, não havia como saber qual campo o identificava —
 * este registro existe para responder isso com o payload real na mão, em vez
 * de adivinhar nomes de campo.
 *
 * Guarda só os últimos eventos: é ferramenta de conferência, não histórico.
 */
const LIMITE = 50;

export type WebhookEvent = {
  id: string;
  provider: string;
  receivedAt: number;
  providerRef?: string;
  /** O que o sistema fez: venda-nova, venda-atualizada, ignorado-saida… */
  decision: string;
  /** Corpo cru recebido, como texto. */
  body: string;
};

type Row = {
  id: string;
  provider: string;
  received_at: number;
  provider_ref: string | null;
  decision: string;
  body: string;
};

export function logWebhookEvent(input: {
  provider: string;
  providerRef?: string;
  decision: string;
  body: unknown;
}): void {
  try {
    const db = getDb();
    const texto =
      typeof input.body === "string" ? input.body : JSON.stringify(input.body ?? {}, null, 1);
    db.prepare(
      `INSERT INTO webhook_events (id, provider, received_at, provider_ref, decision, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.provider,
      Date.now(),
      input.providerRef || null,
      input.decision,
      texto.slice(0, 4000),
    );
    // Poda os antigos, mantendo a tabela pequena.
    db.prepare(
      `DELETE FROM webhook_events WHERE id NOT IN (
         SELECT id FROM webhook_events ORDER BY received_at DESC LIMIT ?
       )`,
    ).run(LIMITE);
  } catch {
    /* registrar não pode derrubar o webhook — o gateway reenviaria em loop */
  }
}

export function listWebhookEvents(limit = LIMITE): WebhookEvent[] {
  const rows = getDb()
    .prepare("SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    receivedAt: r.received_at,
    providerRef: r.provider_ref || undefined,
    decision: r.decision,
    body: r.body,
  }));
}
