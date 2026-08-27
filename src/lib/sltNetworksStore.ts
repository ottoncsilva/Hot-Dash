import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { SltNetwork } from "./sltNetworks";

/**
 * Cadastro das redes/origens de tráfego do SLT (Instagram, TikTok, etc.) —
 * ver Configurações → Links da Bio. Nasce semeado com as opções que existiam
 * como lista fixa (`ensureDefaultSltNetworks` em `db.ts`); o operador
 * adiciona o resto por aqui.
 */

type Row = { id: string; key: string; label: string };

export function listSltNetworks(): SltNetwork[] {
  return getDb()
    .prepare("SELECT id, key, label FROM slt_networks ORDER BY sort_order, label")
    .all() as Row[];
}

export function isValidSltNetworkKey(key: string): boolean {
  const row = getDb().prepare("SELECT 1 FROM slt_networks WHERE key = ?").get(key);
  return Boolean(row);
}

/** "Anúncios no Google" -> "anuncios-no-google". Sem acento e sem espaço:
 *  é o valor que fica gravado para sempre em `traffic_source` — precisa
 *  sobreviver a qualquer editor de URL/CSV sem se corromper. */
function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createSltNetwork(label: string): SltNetwork {
  const nome = label.trim();
  if (!nome) throw new Error("Informe o nome da rede.");
  const base = slugify(nome) || "rede";
  const db = getDb();
  const existe = (k: string) => db.prepare("SELECT 1 FROM slt_networks WHERE key = ?").get(k);
  let key = base;
  let n = 2;
  while (existe(key)) key = `${base}-${n++}`;
  const { max } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) max FROM slt_networks").get() as {
    max: number;
  };
  const id = randomUUID();
  db.prepare(
    "INSERT INTO slt_networks (id, key, label, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, key, nome, max + 1, Date.now());
  return { id, key, label: nome };
}

export function deleteSltNetwork(id: string): boolean {
  const r = getDb().prepare("DELETE FROM slt_networks WHERE id = ?").run(id);
  return r.changes > 0;
}
