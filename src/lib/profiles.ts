import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { countPostsByProfile } from "./posts";
import { totalPaidCentsByProfile } from "./transactions";
import { listProfileStatuses } from "./profileStatuses";
import type { Profile, SocialAccount, SocialNetwork } from "./types";

type AccountRow = {
  id: string;
  profile_id: string;
  network: string;
  username: string;
  url: string | null;
  login: string | null;
  password_enc: string | null;
  notes: string | null;
  created_at: number;
  sort_order: number;
  active: number;
  linked_account_id: string | null;
};
/**
 * O que a modelo NUNCA faz. Nasce preenchida em toda modelo nova (e no
 * backfill de quem já existia — ver `backfillPersonaDoLtv` em `db.ts`) —
 * é a parte que mais custa caro esquecer: sem limite escrito, a IA marca
 * encontro, promete o que não existe e conta que é uma IA quando o lead
 * pergunta. Editável por cima a qualquer momento.
 */
export const LIMITS_PADRAO =
  "## REGRAS INEGOCIÁVEIS E LIMITES ESTRITOS DA IA:\n" +
  "- NUNCA diga, sugira ou deixe transparecer que você é uma Inteligência Artificial, um bot, um assistente virtual, um sistema automatizado ou uma equipe de atendimento.\n" +
  '- NUNCA mencione palavras de sistema como "prompt", "diretrizes", "IA", "modelo de linguagem", "atualização" ou "desenvolvedor".\n' +
  "- A ilusão de realidade deve ser mantida 100% do tempo: para o lead, quem está digitando e enviando as fotos do outro lado da tela é a própria modelo.\n" +
  "- NUNCA marque ou prometa encontros presenciais. Se o lead insistir muito, diga que seu momento agora é curtir a liberdade online e que você é muito seletiva para a vida real.\n" +
  "- NUNCA prometa conteúdos, fetiches ou pacotes que não estão na sua lista oficial de produtos. Trabalhe apenas com o que você tem disponível no catálogo.\n" +
  "- NUNCA implore por vendas ou demonstre desespero financeiro (pedindo dinheiro por emergência, contas a pagar, etc.). Você vende conteúdo por prazer e vaidade, não por necessidade básica.\n" +
  "- NUNCA perca a postura. Mesmo ao dar foras ou cortes, mantenha a educação e a classe.";

type ProfileRow = {
  id: string;
  name: string;
  avatar_path: string | null;
  notes: string | null;
  status: string;
  bio_physical: string | null;
  bio_unique: string | null;
  bio_personality: string | null;
  tone_tags: string | null;
  limits: string | null;
  bio_vip_link: string | null;
  vip_link_auto: string | null;
  vip_link_auto_source: string | null;
  bio_whatsapp_link: string | null;
  bio_whatsapp_button: string | null;
  bio_telegram_link: string | null;
  bio_telegram_button: string | null;
  imagegen_reference_ids: string | null;
  imagegen_prompt_base: string | null;
  videogen_prompt_base: string | null;
  videogen_prompt_controle: string | null;
  created_at: number;
  updated_at: number;
};

/** Lista de ids guardada como JSON — o `filter` protege de linha corrompida. */
function parseIds(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : undefined;
  } catch {
    return undefined;
  }
}

function accountToClient(a: AccountRow): SocialAccount {
  return {
    id: a.id,
    network: a.network as SocialNetwork,
    username: a.username,
    url: a.url || undefined,
    login: a.login || undefined,
    hasPassword: Boolean(a.password_enc),
    notes: a.notes || undefined,
    // `active` é NOT NULL DEFAULT 1 no banco, mas a coluna nasceu numa migração:
    // um `undefined` aqui viraria conta desligada em base antiga, então só o 0
    // explícito desliga.
    active: a.active !== 0,
    linkedAccountId: a.linked_account_id || undefined,
  };
}

function loadAccounts(profileId: string): SocialAccount[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM accounts WHERE profile_id = ? ORDER BY sort_order, created_at",
    )
    .all(profileId) as AccountRow[];
  return rows.map(accountToClient);
}

function profileToClient(p: ProfileRow): Profile {
  return {
    id: p.id,
    name: p.name,
    avatarPath: p.avatar_path,
    notes: p.notes || undefined,
    accounts: loadAccounts(p.id),
    status: p.status,
    bioPhysical: p.bio_physical || undefined,
    bioUnique: p.bio_unique || undefined,
    bioPersonality: (p.bio_personality as any) || "safadinha",
    toneTags: parseIds(p.tone_tags) || [],
    limits: p.limits || LIMITS_PADRAO,
    bioVipLink: p.bio_vip_link || undefined,
    vipLinkAuto: p.vip_link_auto || undefined,
    vipLinkAutoSource: p.vip_link_auto_source || undefined,
    bioWhatsappLink: p.bio_whatsapp_link || undefined,
    bioWhatsappButton: p.bio_whatsapp_button || undefined,
    bioTelegramLink: p.bio_telegram_link || undefined,
    bioTelegramButton: p.bio_telegram_button || undefined,
    imagegenReferenceIds: parseIds(p.imagegen_reference_ids),
    imagegenPromptBase: p.imagegen_prompt_base || undefined,
    videogenPromptBase: p.videogen_prompt_base || undefined,
    videogenPromptControle: p.videogen_prompt_controle || undefined,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/**
 * Lista completa pra tela de Modelos — inclui contagem de posts e
 * faturamento pago por perfil (não computados em `profileToClient` porque a
 * maioria das chamadas internas, ex. após adicionar uma conta, não precisa
 * desses dois números).
 */
export async function listProfiles(): Promise<Profile[]> {
  const rows = getDb()
    .prepare("SELECT * FROM profiles ORDER BY name COLLATE NOCASE")
    .all() as ProfileRow[];
  return rows.map((row) => {
    const profile = profileToClient(row);
    profile.postCount = countPostsByProfile(profile.id);
    profile.revenuePaidCents = totalPaidCentsByProfile(profile.id);
    return profile;
  });
}

export async function getProfile(id: string): Promise<Profile | null> {
  const row = getDb()
    .prepare("SELECT * FROM profiles WHERE id = ?")
    .get(id) as ProfileRow | undefined;
  return row ? profileToClient(row) : null;
}

export async function createProfile(input: {
  name: string;
  notes?: string;
}): Promise<Profile> {
  const [defaultStatus] = listProfileStatuses();
  if (!defaultStatus) {
    throw new Error("Crie ao menos um status antes de criar um modelo.");
  }
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO profiles (id, name, avatar_path, notes, status, bio_personality, limits, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'safadinha', ?, ?, ?)`,
    )
    .run(id, input.name.trim(), input.notes?.trim() || "", defaultStatus.id, LIMITS_PADRAO, now, now);
  return (await getProfile(id))!;
}

export async function updateProfile(
  id: string,
  patch: {
    name?: string;
    notes?: string;
    avatarPath?: string | null;
    status?: string;
    bioPhysical?: string;
    bioUnique?: string;
    bioPersonality?: "santinha" | "safadinha" | "explicita";
    toneTags?: string[];
    limits?: string;
    bioVipLink?: string;
    bioWhatsappLink?: string;
    bioWhatsappButton?: string;
    bioTelegramLink?: string;
    bioTelegramButton?: string;
    imagegenReferenceIds?: string[];
    imagegenPromptBase?: string;
    videogenPromptBase?: string;
    videogenPromptControle?: string;
  },
): Promise<Profile | null> {
  const existing = getDb()
    .prepare("SELECT id FROM profiles WHERE id = ?")
    .get(id);
  if (!existing) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name.trim());
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(patch.notes.trim());
  }
  if (patch.avatarPath !== undefined) {
    sets.push("avatar_path = ?");
    vals.push(patch.avatarPath);
  }
  if (patch.bioPhysical !== undefined) {
    sets.push("bio_physical = ?");
    vals.push(patch.bioPhysical.trim());
  }
  if (patch.bioUnique !== undefined) {
    sets.push("bio_unique = ?");
    vals.push(patch.bioUnique.trim());
  }
  if (patch.bioPersonality !== undefined) {
    sets.push("bio_personality = ?");
    vals.push(patch.bioPersonality);
  }
  if (patch.toneTags !== undefined) {
    sets.push("tone_tags = ?");
    vals.push(JSON.stringify(patch.toneTags));
  }
  if (patch.limits !== undefined) {
    sets.push("limits = ?");
    // Vazio volta a valer o padrão — mesma lógica do prompt do Gerador de
    // Imagem/Vídeo logo abaixo: campo em branco não é "sem limite nenhum".
    vals.push(patch.limits.trim() || LIMITS_PADRAO);
  }
  if (patch.bioVipLink !== undefined) {
    sets.push("bio_vip_link = ?");
    vals.push(patch.bioVipLink.trim());
  }
  if (patch.bioWhatsappLink !== undefined) {
    sets.push("bio_whatsapp_link = ?");
    vals.push(patch.bioWhatsappLink.trim());
  }
  if (patch.bioWhatsappButton !== undefined) {
    sets.push("bio_whatsapp_button = ?");
    vals.push(patch.bioWhatsappButton.trim());
  }
  if (patch.bioTelegramLink !== undefined) {
    sets.push("bio_telegram_link = ?");
    vals.push(patch.bioTelegramLink.trim());
  }
  if (patch.bioTelegramButton !== undefined) {
    sets.push("bio_telegram_button = ?");
    vals.push(patch.bioTelegramButton.trim());
  }
  if (patch.imagegenReferenceIds !== undefined) {
    sets.push("imagegen_reference_ids = ?");
    vals.push(patch.imagegenReferenceIds.length ? JSON.stringify(patch.imagegenReferenceIds) : null);
  }
  // Prompt em branco volta a valer o padrão do código — por isso vira NULL em
  // vez de string vazia: é o "não configurado" que o gerador já sabe ler.
  if (patch.imagegenPromptBase !== undefined) {
    sets.push("imagegen_prompt_base = ?");
    vals.push(patch.imagegenPromptBase.trim() || null);
  }
  if (patch.videogenPromptBase !== undefined) {
    sets.push("videogen_prompt_base = ?");
    vals.push(patch.videogenPromptBase.trim() || null);
  }
  if (patch.videogenPromptControle !== undefined) {
    sets.push("videogen_prompt_controle = ?");
    vals.push(patch.videogenPromptControle.trim() || null);
  }
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  getDb()
    .prepare(`UPDATE profiles SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
  return getProfile(id);
}

/** Exclui o perfil (as contas somem por CASCADE). Retorna true se existia. */
export async function deleteProfile(id: string): Promise<boolean> {
  const info = getDb().prepare("DELETE FROM profiles WHERE id = ?").run(id);
  return info.changes > 0;
}

/**
 * Valida um vínculo de ESPELHO e devolve o id a gravar (ou `null`).
 *
 * Só Facebook e Threads espelham, e só um INSTAGRAM DA MESMA MODELO. As três
 * condições existem por motivos diferentes:
 *
 *  - a rede de origem, porque espelhar é o que o app do Instagram faz ao
 *    publicar; um TikTok apontando para um Instagram não descreve nada real;
 *  - o alvo ser Instagram, para o vínculo não virar uma corrente (um Threads
 *    espelhando um Facebook que espelha um Instagram);
 *  - o alvo ser da MESMA modelo, senão o cadastro de uma diria que publica no
 *    perfil de outra.
 *
 * Uma conta também não espelha a si mesma (`exceto`, no update).
 */
function espelhoValido(
  profileId: string,
  network: SocialNetwork | undefined,
  linkedAccountId: string | null | undefined,
  exceto?: string,
): string | null {
  if (!linkedAccountId) return null;
  if (network !== "facebook" && network !== "threads") return null;
  if (exceto && linkedAccountId === exceto) return null;
  const alvo = getDb()
    .prepare("SELECT network FROM accounts WHERE id = ? AND profile_id = ?")
    .get(linkedAccountId, profileId) as { network: string } | undefined;
  return alvo?.network === "instagram" ? linkedAccountId : null;
}

export async function addAccount(
  profileId: string,
  input: {
    network: SocialNetwork;
    username: string;
    url?: string;
    login?: string;
    password?: string;
    notes?: string;
    linkedAccountId?: string | null;
  },
): Promise<Profile | null> {
  const exists = getDb()
    .prepare("SELECT id FROM profiles WHERE id = ?")
    .get(profileId);
  if (!exists) return null;

  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO accounts
        (id, profile_id, network, username, url, login, password_enc, notes, created_at, sort_order,
         active, linked_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      randomUUID(),
      profileId,
      input.network,
      input.username.trim(),
      input.url?.trim() || null,
      input.login?.trim() || null,
      input.password ? encryptSecret(input.password) : null,
      input.notes?.trim() || null,
      now,
      now,
      // O vínculo só faz sentido em Facebook/Threads apontando para um
      // Instagram DA MESMA MODELO — ver `espelhoValido`.
      espelhoValido(profileId, input.network, input.linkedAccountId),
    );
  getDb()
    .prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
    .run(now, profileId);
  return getProfile(profileId);
}

export async function updateAccount(
  profileId: string,
  accountId: string,
  input: {
    network?: SocialNetwork;
    username?: string;
    url?: string;
    login?: string;
    active?: boolean;
    /** "" ou null remove o vínculo; um id o define. Ver `espelhoValido`. */
    linkedAccountId?: string | null;
    /** undefined = mantém; "" = remove a senha; string = nova senha. */
    password?: string;
    notes?: string;
  },
): Promise<Profile | null> {
  const row = getDb()
    .prepare("SELECT id FROM accounts WHERE id = ? AND profile_id = ?")
    .get(accountId, profileId);
  if (!row) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.network !== undefined) {
    sets.push("network = ?");
    vals.push(input.network);
  }
  if (input.username !== undefined) {
    sets.push("username = ?");
    vals.push(input.username.trim());
  }
  if (input.url !== undefined) {
    sets.push("url = ?");
    vals.push(input.url.trim() || null);
  }
  if (input.login !== undefined) {
    sets.push("login = ?");
    vals.push(input.login.trim() || null);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(input.notes.trim() || null);
  }
  if (input.password !== undefined) {
    sets.push("password_enc = ?");
    vals.push(input.password ? encryptSecret(input.password) : null);
  }
  if (input.active !== undefined) {
    sets.push("active = ?");
    vals.push(input.active ? 1 : 0);
  }
  if (input.linkedAccountId !== undefined) {
    // A rede da conta pode estar mudando NESTA mesma chamada: valida contra a
    // rede nova quando ela veio, senão contra a que está gravada. Sem isso,
    // trocar Instagram → Facebook e escolher o espelho no mesmo salvamento
    // seria recusado por causa da rede antiga.
    const redeAtual =
      input.network ??
      ((getDb().prepare("SELECT network FROM accounts WHERE id = ?").get(accountId) as
        | { network: string }
        | undefined)?.network as SocialNetwork | undefined);
    sets.push("linked_account_id = ?");
    vals.push(espelhoValido(profileId, redeAtual, input.linkedAccountId, accountId));
  }
  if (sets.length > 0) {
    vals.push(accountId);
    getDb()
      .prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals);
    getDb()
      .prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
      .run(Date.now(), profileId);
  }
  return getProfile(profileId);
}

export async function deleteAccount(
  profileId: string,
  accountId: string,
): Promise<Profile | null> {
  getDb()
    .prepare("DELETE FROM accounts WHERE id = ? AND profile_id = ?")
    .run(accountId, profileId);
  // Apagar um Instagram deixa os espelhos apontando para o nada, e a tela leria
  // isso como "espelha uma conta que não existe". Solta os filhos.
  getDb()
    .prepare("UPDATE accounts SET linked_account_id = NULL WHERE linked_account_id = ?")
    .run(accountId);
  getDb()
    .prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
    .run(Date.now(), profileId);
  return getProfile(profileId);
}

export async function revealPassword(
  profileId: string,
  accountId: string,
): Promise<string | null> {
  const row = getDb()
    .prepare(
      "SELECT password_enc FROM accounts WHERE id = ? AND profile_id = ?",
    )
    .get(accountId, profileId) as { password_enc: string | null } | undefined;
  if (!row?.password_enc) return null;
  return decryptSecret(row.password_enc);
}
