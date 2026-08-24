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
  /** Id do lead no Telegram, para {id}. */
  telegramUserId?: number;
  /** Nome do plano/oferta que o lead JÁ escolheu — só preenchido no Downsell
   * de PIX gerado, quando dá pra resolver o que ele selecionou (ver
   * `buildPixDownsellMarkup`). Nos demais funis fica vazio, como as outras
   * variáveis sem valor. */
  planoEscolhido?: string;
  /** Preço do plano/oferta acima JÁ COM o desconto do passo, formatado em
   * R$. Anda sempre junto de `planoEscolhido`. */
  valorComDesconto?: string;
};

/** O que a tela mostra nos chips, com a explicação de cada uma. */
export const TELEGRAM_VARS: [string, string][] = [
  ["{nome}", "primeiro nome do lead no Telegram"],
  ["{sobrenome}", "sobrenome, quando o Telegram informa"],
  ["{nome_completo}", "nome e sobrenome juntos"],
  ["{usuario}", "@username do lead (fica vazio para quem não tem)"],
  ["{saudacao}", "Bom dia / Boa tarde / Boa noite, pelo fuso da operação"],
  ["{modelo}", "nome da modelo"],
  ["{bot}", "@ do bot"],
  ["{plano}", "plano/oferta que o lead já escolheu (só no Downsell de PIX gerado)"],
  ["{valor}", "preço desse plano já com o desconto do passo (idem)"],
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
  const sobrenome = (ctx.lastName || "").trim();
  const usuario = (ctx.username || "").replace(/^@/, "").trim();
  const bot = (ctx.botUsername || "").replace(/^@/, "").trim();

  const valores: Record<string, string> = {
    nome: nome || "linda(o)",
    sobrenome,
    nome_completo: [nome, sobrenome].filter(Boolean).join(" ") || nome || "linda(o)",
    usuario: usuario ? `@${usuario}` : "",
    saudacao: saudacao(),
    modelo: (ctx.profileName || "").trim(),
    bot: bot ? `@${bot}` : "",
    id: ctx.telegramUserId ? String(ctx.telegramUserId) : "",
    plano: (ctx.planoEscolhido || "").trim(),
    valor: (ctx.valorComDesconto || "").trim(),
  };

  return (texto || "").replace(/\{([a-zA-Z_ç.]+)\}/g, (chaveInteira, chave: string) => {
    // "{bot.nome}" é aceito como apelido de "{bot}" — é o nome usado na
    // referência de onde as copies costumam ser copiadas.
    const k = chave.toLowerCase().replace("bot.nome", "bot").replace("nome.bot", "bot");
    const v = valores[k];
    // Chave desconhecida fica como está: apagá-la esconderia o erro de
    // digitação, e o operador só descobriria pelo buraco na frase.
    return v === undefined ? chaveInteira : escaparHtml(v);
  });
}

/**
 * Escapa o valor SUBSTITUÍDO, não o texto do operador.
 *
 * As mensagens saem com parse_mode HTML, e a formatação escrita na tela (<b>,
 * <i>) tem que continuar valendo. Já o nome de um lead não: alguém chamado
 * "<b" faria o Telegram recusar a mensagem inteira por HTML malformado — e o
 * disparo pararia por causa de um cadastro alheio.
 */
function escaparHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
