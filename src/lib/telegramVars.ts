import "server-only";
import { getAppTimeZone } from "./settings";
import { partsInTimeZone } from "./timezone";

/**
 * VARIÁVEIS das mensagens do bot.
 *
 * A régua para uma variável entrar aqui é uma só: o painel tem que conseguir
 * preencher o valor DE VERDADE. Variável que sempre sai vazia é pior que
 * variável que não existe — quem escreve a copy conta com ela, e o lead recebe
 * um buraco no meio da frase.
 *
 * Por isso não há {email}, {telefone}, {cidade}, {estado} ou {uf}: o Telegram
 * não entrega nada disso para um bot. Ele dá o id, o nome, o sobrenome e o
 * @username, e é sobre isso que a lista abaixo é montada.
 */
export type VarContext = {
  firstName?: string;
  lastName?: string;
  username?: string;
  /** Nome da modelo (perfil). */
  profileName?: string;
  /** @ do bot, sem arroba. */
  botUsername?: string;
};

/** O que a tela mostra nos chips, com a explicação de cada uma. */
export const TELEGRAM_VARS: [string, string][] = [
  ["{nome}", "primeiro nome do lead no Telegram"],
  ["{nome_completo}", "nome e sobrenome, quando o Telegram informa"],
  ["{usuario}", "@username do lead (fica vazio para quem não tem)"],
  ["{saudacao}", "Bom dia / Boa tarde / Boa noite, pelo fuso da operação"],
  ["{modelo}", "nome da modelo"],
  ["{bot}", "@ do bot"],
];

/** Bom dia até 11:59, boa tarde até 17:59, boa noite depois. */
function saudacao(): string {
  const { hour } = partsInTimeZone(Date.now(), getAppTimeZone());
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Troca as variáveis pelo valor real.
 *
 * `{nome}` cai em "linda(o)" quando o Telegram não deu o primeiro nome — é o
 * tratamento que a mensagem espera, e sai melhor que um vazio no meio da
 * frase. As demais viram string vazia quando não há valor, porque inventar um
 * apelido no lugar de um @username seria pior.
 */
export function aplicarVariaveis(texto: string, ctx: VarContext): string {
  const nome = (ctx.firstName || "").trim();
  const completo = [ctx.firstName, ctx.lastName].filter(Boolean).join(" ").trim();
  const usuario = (ctx.username || "").replace(/^@/, "").trim();
  const bot = (ctx.botUsername || "").replace(/^@/, "").trim();

  return (texto || "")
    .replace(/{nome_completo}/gi, completo || nome || "linda(o)")
    .replace(/{nome}/gi, nome || "linda(o)")
    .replace(/{usuario}/gi, usuario ? `@${usuario}` : "")
    .replace(/{saudacao}/gi, saudacao())
    .replace(/{modelo}/gi, (ctx.profileName || "").trim())
    .replace(/{bot}/gi, bot ? `@${bot}` : "");
}
