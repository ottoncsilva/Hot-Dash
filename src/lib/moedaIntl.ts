import "server-only";

/**
 * MOEDA DO LEAD INTERNACIONAL.
 *
 * O bot cobrava todo estrangeiro em dólar. Olhando os cliques reais do SLT
 * (últimos 30 dias), a zona do EURO é MAIOR que a dos EUA — Portugal sozinho
 * (60 cliques) quase iguala os Estados Unidos (72), e com Itália, França e
 * Espanha o euro chega a 82. Cobrar um português em dólar o obriga a
 * converter de cabeça e ainda comer o spread do cartão dele.
 *
 * O VALOR é o mesmo número em qualquer moeda (6 dólares = 6 euros = 6
 * libras) — ver `precoIntl`. Um preço só para manter, sempre redondo.
 *
 * COMO DESCOBRIMOS A MOEDA. O Telegram não diz o país do lead — nenhum
 * update traz isso. O único sinal por pessoa é o `language_code` que vem em
 * todo `from` (ex.: "pt-br", "pt", "en-gb", "it"). É um palpite, não uma
 * certeza: alguém em Lisboa com o celular em inglês cai no dólar. Por isso o
 * mapa abaixo só afirma o que é seguro afirmar, e TUDO que sobra vai pro
 * dólar — errar pra dólar é o comportamento de hoje, então o pior caso desta
 * mudança é continuar como está.
 *
 * O Brasil não passa por aqui: lead brasileiro segue no PIX/BRL de sempre.
 */
export type MoedaIntl = "USD" | "EUR" | "GBP";

export const MOEDAS_INTL: MoedaIntl[] = ["USD", "EUR", "GBP"];

/**
 * `language_code` → moeda. As regras são deliberadamente conservadoras:
 *
 *  • "pt" sem região, ou "pt-pt" → EUR. O brasileiro manda "pt-br", que cai
 *    fora daqui (e nem chega a este fluxo).
 *  • "es-es" → EUR, mas "es" puro → USD: o espanhol sem região é, no volume,
 *    muito mais América Latina (Paraguai aparece nos cliques) do que Espanha,
 *    e cobrar um paraguaio em euro seria pior que em dólar.
 *  • "en-gb" → GBP; "en" puro e "en-us" → USD.
 *  • Idiomas que só se falam na zona do euro (it, fr, de, nl, el, fi) → EUR.
 *    "fr" também é Canadá e Suíça, mas nos cliques reais a França é quem
 *    aparece; e o erro, se houver, é entre duas moedas fortes de cartão.
 */
export function moedaPorIdioma(languageCode?: string | null): MoedaIntl {
  const c = (languageCode || "").trim().toLowerCase();
  if (!c) return "USD";
  const [base, regiao] = c.split("-");

  if (base === "pt") return regiao === "br" ? "USD" : "EUR";
  if (base === "es") return regiao === "es" ? "EUR" : "USD";
  if (base === "en") return regiao === "gb" ? "GBP" : "USD";
  if (["it", "fr", "de", "nl", "el", "fi", "ga", "mt", "sk", "sl", "et", "lv", "lt"].includes(base)) {
    return "EUR";
  }
  return "USD";
}

/** Locale para formatar cada moeda — só afeta separador e posição do símbolo. */
const LOCALE: Record<MoedaIntl | "BRL", string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  BRL: "pt-BR",
};

export function formatarMoeda(cents: number, moeda: MoedaIntl | "BRL"): string {
  return (cents / 100).toLocaleString(LOCALE[moeda], { style: "currency", currency: moeda });
}

/** O que interessa de um plano para decidir preço internacional. */
type PlanoComPrecos = { priceUsdCents?: number };

/**
 * Preço internacional do plano NA MOEDA do lead — o MESMO número cadastrado
 * em dólar, só que cobrado na moeda dele: 6 dólares viram 6 euros, 6 libras.
 *
 * É decisão de preço, não conversão de câmbio, e de propósito. Preço redondo
 * converte melhor que 5,53 € (o que um câmbio de verdade produziria), e
 * manter uma tabela por moeda significaria a modelo cadastrar o mesmo plano
 * três vezes e esquecer de mexer em duas quando o preço mudasse. Como euro e
 * libra valem MAIS que o dólar, o número igual também rende mais por venda lá
 * — não menos.
 *
 * Devolve `undefined` quando o plano não tem preço internacional: aí ele não
 * é vendável lá fora, mesma regra que já existia.
 */
export function precoIntl(plan: PlanoComPrecos, moeda: MoedaIntl): { cents: number; moeda: MoedaIntl } | undefined {
  const cents = plan.priceUsdCents;
  if (!cents || cents <= 0) return undefined;
  return { cents, moeda };
}

/** Vendável lá fora? O preço em dólar é o que habilita, em qualquer moeda. */
export function temPrecoIntl(plan: PlanoComPrecos): boolean {
  return (plan.priceUsdCents || 0) > 0;
}
