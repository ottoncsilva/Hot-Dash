import "server-only";
import { getDb } from "./db";
import { getBotConfigByProfile } from "./telegramDb";
import { getTelegramMe, getTelegramChat, createTelegramInviteLink } from "./telegramApi";

/**
 * O LINK DO VIP, descoberto sozinho.
 *
 * Era um campo que o operador tinha de preencher à mão no cadastro da modelo,
 * e sem ele os posts de conversão das Prévias saíam convidando para lugar
 * nenhum (ou nem eram gerados). Só que o painel já tem tudo o que é preciso
 * para achar esse link: o token do bot e o ID do canal VIP.
 *
 * A ORDEM importa, e ela é de funil, não de conveniência:
 *
 *   1. O BOT (t.me/usuario_do_bot). É o destino certo para uma Prévia: o lead
 *      chega no bot, vê os planos e paga. Mandá-lo direto para o canal VIP
 *      seria entregar o produto de graça.
 *   2. O VIP PÚBLICO (t.me/usuario_do_grupo), quando o grupo tem @username.
 *   3. O CONVITE PRIMÁRIO do VIP, lido pelo getChat.
 *   4. Um convite NOVO, criado com createChatInviteLink.
 *
 * Sobre 3 e 4, a documentação do Telegram é explícita, e é aí que mora a
 * armadilha:
 *
 *   • exportChatInviteLink — "generate a new primary invite link for a chat;
 *     any previously generated primary link is revoked". NÃO É USADO AQUI, e
 *     não pode passar a ser: ele invalidaria todo link já distribuído, o que
 *     transformaria uma conveniência do painel em prejuízo real.
 *   • "If you want your bot to work with invite links, it will need to
 *     generate its own link using exportChatInviteLink or by calling the
 *     getChat method" — o getChat devolve o link primário SEM revogar nada, e
 *     é por isso que ele vem antes.
 *   • createChatInviteLink cria um link ADICIONAL ("an additional invite
 *     link"), também sem revogar nada.
 */

export type VipLinkSource = "manual" | "bot" | "vip_publico" | "vip_convite" | "vip_novo_convite";

export const VIP_LINK_SOURCE_LABEL: Record<VipLinkSource, string> = {
  manual: "preenchido por você",
  bot: "conversa do bot",
  vip_publico: "@ público do canal VIP",
  vip_convite: "convite do canal VIP",
  vip_novo_convite: "convite criado agora para o canal VIP",
};

export type LinkDoVip = {
  link: string;
  source?: VipLinkSource;
  /** Por que não deu para descobrir. Só vem quando `link` está vazio. */
  problem?: string;
};

/** O que vale na hora de montar um post. Não fala com o Telegram: lê o que o
 *  operador escreveu e, na falta dele, o que já foi descoberto e guardado. */
export function linkDoVip(profile: { bioVipLink?: string; vipLinkAuto?: string }): string {
  return (profile.bioVipLink || "").trim() || (profile.vipLinkAuto || "").trim();
}

function lerCache(profileId: string): { link: string; source?: VipLinkSource } {
  const row = getDb()
    .prepare("SELECT bio_vip_link, vip_link_auto, vip_link_auto_source FROM profiles WHERE id = ?")
    .get(profileId) as
    | { bio_vip_link: string | null; vip_link_auto: string | null; vip_link_auto_source: string | null }
    | undefined;
  if (!row) return { link: "" };
  const manual = (row.bio_vip_link || "").trim();
  if (manual) return { link: manual, source: "manual" };
  return {
    link: (row.vip_link_auto || "").trim(),
    source: (row.vip_link_auto_source as VipLinkSource) || undefined,
  };
}

function gravarCache(profileId: string, link: string, source: VipLinkSource): void {
  getDb()
    .prepare("UPDATE profiles SET vip_link_auto = ?, vip_link_auto_source = ? WHERE id = ?")
    .run(link, source, profileId);
}

/** Esquece o que foi descoberto. Chamado quando o bot muda (token ou grupo),
 *  porque aí o link guardado pode estar apontando para a operação errada. */
export function limparLinkDoVipAuto(profileId: string): void {
  getDb()
    .prepare("UPDATE profiles SET vip_link_auto = NULL, vip_link_auto_source = NULL WHERE id = ?")
    .run(profileId);
}

/**
 * Garante um link do VIP para este perfil, descobrindo-o se preciso.
 *
 * Com cache: só fala com o Telegram quando ainda não há nada guardado, ou
 * quando `forcar` pede. Sem isso, cada carregamento de tela viraria uma
 * chamada de API por modelo.
 */
export async function resolverLinkDoVip(
  profileId: string,
  forcar = false,
): Promise<LinkDoVip> {
  const cache = lerCache(profileId);
  if (cache.link && !forcar) return { link: cache.link, source: cache.source };
  // O manual sempre manda, mesmo com `forcar`: forçar serve para redescobrir o
  // automático, não para passar por cima do que o operador escreveu.
  if (cache.source === "manual") return { link: cache.link, source: "manual" };

  const bot = getBotConfigByProfile(profileId);
  if (!bot?.botToken) {
    return { link: "", problem: "Bot não configurado para esta modelo — sem token não dá para descobrir o link." };
  }

  // 1. O bot. Usa o username já salvo e, na falta dele, pergunta ao Telegram.
  let username = (bot.botUsername || "").trim();
  if (!username) {
    try {
      username = ((await getTelegramMe(bot.botToken)).username || "").trim();
    } catch {
      /* token inválido cai nos passos do grupo, que reportam o erro real */
    }
  }
  if (username) {
    const link = `https://t.me/${username.replace(/^@/, "")}`;
    gravarCache(profileId, link, "bot");
    return { link, source: "bot" };
  }

  if (!bot.idVip?.trim()) {
    return { link: "", problem: "Sem @ do bot e sem canal VIP cadastrado — não há de onde tirar o link." };
  }

  // 2 e 3. Uma chamada só de getChat responde as duas: o @ público do grupo e
  // o convite primário que o próprio bot já tem.
  try {
    const chat = await getTelegramChat(bot.botToken, bot.idVip);
    if (chat.username) {
      const link = `https://t.me/${chat.username.replace(/^@/, "")}`;
      gravarCache(profileId, link, "vip_publico");
      return { link, source: "vip_publico" };
    }
    if (chat.invite_link) {
      gravarCache(profileId, chat.invite_link, "vip_convite");
      return { link: chat.invite_link, source: "vip_convite" };
    }
  } catch (e) {
    return {
      link: "",
      problem:
        e instanceof Error
          ? `O bot não consegue ler o canal VIP (${e.message}). Confira o ID e se ele é administrador ali.`
          : "O bot não consegue ler o canal VIP.",
    };
  }

  // 4. Último recurso: cria um convite ADICIONAL (nada é revogado).
  try {
    const invite = await createTelegramInviteLink(bot.botToken, bot.idVip, "Hot-Dash");
    gravarCache(profileId, invite.invite_link, "vip_novo_convite");
    return { link: invite.invite_link, source: "vip_novo_convite" };
  } catch (e) {
    return {
      link: "",
      problem:
        e instanceof Error
          ? `Não foi possível gerar o convite do VIP (${e.message}). O bot precisa ser administrador do canal com permissão de convidar por link.`
          : "Não foi possível gerar o convite do VIP.",
    };
  }
}
