import "server-only";
import { randomUUID } from "node:crypto";
import { gerarCodigoLegivel } from "./codigoLegivel";
import { getDb } from "./db";
import type { DeliveryTarget } from "./types";

/**
 * APARELHOS DE ENTREGA — os celulares que recebem o post pronto no horário.
 *
 * Cada conta de rede social (`accounts.delivery_target_id`) aponta para um
 * deles, porque duas contas da mesma modelo podem rodar em celulares
 * diferentes: é isso que decide para onde a foto e a legenda das 14h vão.
 *
 * O PAREAMENTO não é burocracia: a API do Telegram não deixa um bot iniciar
 * conversa: ele só consegue escrever para quem já falou com ele. Por isso o
 * aparelho nasce com um código, alguém manda `/vincular <código>` no celular,
 * e só então o `chat_id` existe e a entrega funciona. Enquanto não parear, o
 * aparelho aparece no painel como pendente e é PULADO pelo motor de entrega.
 */

type TargetRow = {
  id: string;
  profile_id: string;
  label: string;
  chat_id: string | null;
  chat_name: string | null;
  pair_code: string | null;
  paired_at: number | null;
  active: number;
  created_at: number;
  updated_at: number;
};

function toClient(r: TargetRow): DeliveryTarget {
  return {
    id: r.id,
    profileId: r.profile_id,
    label: r.label,
    chatId: r.chat_id || undefined,
    chatName: r.chat_name || undefined,
    pairCode: r.pair_code || undefined,
    pairedAt: r.paired_at || undefined,
    active: r.active !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function gerarPairCode(): string {
  const db = getDb();
  // Colisão é improvável (27^6), mas o índice único faria o INSERT explodir na
  // cara do operador. Tentar de novo é mais barato que explicar o erro.
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const code = gerarCodigoLegivel(6);
    const existe = db
      .prepare("SELECT id FROM delivery_targets WHERE pair_code = ?")
      .get(code);
    if (!existe) return code;
  }
  throw new Error("Não consegui gerar um código de vínculo livre. Tente de novo.");
}

export function listTargets(profileId: string): DeliveryTarget[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM delivery_targets WHERE profile_id = ? ORDER BY created_at",
    )
    .all(profileId) as TargetRow[];
  return rows.map(toClient);
}

export function getTarget(id: string): DeliveryTarget | null {
  const r = getDb()
    .prepare("SELECT * FROM delivery_targets WHERE id = ?")
    .get(id) as TargetRow | undefined;
  return r ? toClient(r) : null;
}

export function createTarget(profileId: string, label: string): DeliveryTarget {
  const nome = label.trim();
  if (!nome) throw new Error("Dê um nome ao aparelho (ex.: “iPhone da Bruna”).");
  const existe = getDb().prepare("SELECT id FROM profiles WHERE id = ?").get(profileId);
  if (!existe) throw new Error("Modelo não encontrada.");
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO delivery_targets
        (id, profile_id, label, pair_code, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, profileId, nome, gerarPairCode(), now, now);
  return getTarget(id)!;
}

export function updateTarget(
  id: string,
  patch: { label?: string; active?: boolean },
): DeliveryTarget | null {
  const atual = getTarget(id);
  if (!atual) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.label !== undefined) {
    const nome = patch.label.trim();
    if (!nome) throw new Error("Dê um nome ao aparelho.");
    sets.push("label = ?");
    vals.push(nome);
  }
  if (patch.active !== undefined) {
    sets.push("active = ?");
    vals.push(patch.active ? 1 : 0);
  }
  if (sets.length === 0) return atual;
  sets.push("updated_at = ?");
  vals.push(Date.now(), id);
  getDb()
    .prepare(`UPDATE delivery_targets SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
  return getTarget(id);
}

/**
 * Desfaz o vínculo e sorteia um código novo — é o caminho de "troquei de
 * celular". O aparelho continua escolhido nas contas que apontam para ele;
 * só para de receber até parear de novo.
 */
export function resetTarget(id: string): DeliveryTarget | null {
  const atual = getTarget(id);
  if (!atual) return null;
  getDb()
    .prepare(
      `UPDATE delivery_targets
         SET chat_id = NULL, chat_name = NULL, paired_at = NULL, pair_code = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(gerarPairCode(), Date.now(), id);
  return getTarget(id);
}

export function deleteTarget(id: string): boolean {
  // As contas que apontavam para ele ficam sem entrega (SQLite não aplica
  // ON DELETE em coluna que nasceu por ALTER TABLE, então é na mão).
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      "UPDATE accounts SET delivery_target_id = NULL WHERE delivery_target_id = ?",
    ).run(id);
    return db.prepare("DELETE FROM delivery_targets WHERE id = ?").run(id);
  });
  return run().changes > 0;
}

export function findTargetByPairCode(code: string): DeliveryTarget | null {
  const limpo = code.trim().toUpperCase();
  if (!limpo) return null;
  const r = getDb()
    .prepare("SELECT * FROM delivery_targets WHERE pair_code = ?")
    .get(limpo) as TargetRow | undefined;
  return r ? toClient(r) : null;
}

/**
 * Fecha o vínculo: grava o chat e queima o código.
 *
 * O código sai (`pair_code = NULL`) porque ele é de uso único — deixá-lo vivo
 * permitiria que qualquer um que o visse por cima do ombro redirecionasse os
 * posts da modelo para o próprio Telegram.
 */
export function pairTarget(
  id: string,
  chatId: string,
  chatName?: string,
): DeliveryTarget | null {
  getDb()
    .prepare(
      `UPDATE delivery_targets
         SET chat_id = ?, chat_name = ?, pair_code = NULL, paired_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(chatId, chatName || null, Date.now(), Date.now(), id);
  return getTarget(id);
}

/**
 * Todos os aparelhos do painel, com o nome da modelo junto.
 *
 * É o que o MENU do bot lista: quem está com o celular na mão escolhe a
 * modelo e depois o aparelho, em vez de decorar um código. Vem tudo de uma
 * consulta só porque a lista é pequena (aparelhos, não mídias) e o menu
 * precisa dela inteira para montar as páginas.
 */
export function listAllTargets(): (DeliveryTarget & { profileName: string })[] {
  const rows = getDb()
    .prepare(
      `SELECT t.*, pr.name AS profile_name
         FROM delivery_targets t
         JOIN profiles pr ON pr.id = t.profile_id
        ORDER BY pr.name COLLATE NOCASE, t.created_at`,
    )
    .all() as (TargetRow & { profile_name: string })[];
  return rows.map((r) => ({ ...toClient(r), profileName: r.profile_name }));
}

/** Os aparelhos que ESTE chat do Telegram recebe hoje. */
export function targetsByChat(chatId: string): (DeliveryTarget & { profileName: string })[] {
  return listAllTargets().filter((t) => t.chatId === chatId);
}

/**
 * Solta o chat de todos os aparelhos que ele recebia — o "não quero mais
 * receber nada aqui" do menu.
 *
 * Cada aparelho volta a ter código: sem isso ele ficaria órfão no painel, sem
 * chat e sem como parear de novo a não ser pelo botão "trocar de celular".
 */
export function unpairChat(chatId: string): number {
  const db = getDb();
  const alvos = db
    .prepare("SELECT id FROM delivery_targets WHERE chat_id = ?")
    .all(chatId) as { id: string }[];
  for (const a of alvos) resetTarget(a.id);
  return alvos.length;
}
