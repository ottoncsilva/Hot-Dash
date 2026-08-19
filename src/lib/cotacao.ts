import "server-only";
import { configJson } from "./settings";

/**
 * COTAÇÃO DO DÓLAR, para mostrar o custo das gerações em real.
 *
 * A OpenRouter cobra em dólar; quem opera o painel raciocina em real. Em vez
 * de fixar uma taxa no código (que envelhece e vira mentira), busca a do dia
 * e guarda em `settings`.
 *
 * Fonte primária é o PTAX do Banco Central — é a taxa OFICIAL, a que o
 * contador usa, e não a de uma casa de câmbio qualquer. Ele só publica em dia
 * útil, então a busca anda para trás até achar o último boletim (feriado e
 * fim de semana não têm cotação). Se o BC não responder, cai numa fonte
 * aberta; se as duas falharem, devolve a última guardada, mesmo velha, com a
 * data dela — um valor de ontem rotulado como de ontem é melhor que nenhum.
 */

export type Cotacao = {
  /** Quantos reais vale um dólar. */
  brlPorUsd: number;
  /** Dia a que a cotação se refere (ISO, só a data). */
  dataCotacao: string;
  fonte: string;
  /** Quando nós buscamos — controla o revalidar, não é a data da cotação. */
  obtidoEm: number;
};

const CHAVE = "cotacaoUsdBrl";

/** Meia jornada: o PTAX de fechamento sai no fim da tarde, então reconsultar
 *  de 6 em 6 horas pega o do dia sem martelar a API do BC. */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

function ehNumeroUtil(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** PTAX do Banco Central, andando para trás até achar um dia com boletim. */
async function buscarPtax(): Promise<Cotacao | null> {
  for (let atras = 0; atras < 8; atras++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - atras);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const url =
      `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)` +
      `?@dataCotacao='${mm}-${dd}-${d.getUTCFullYear()}'&$format=json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { value?: { cotacaoVenda?: number }[] };
      const venda = data.value?.[0]?.cotacaoVenda;
      if (ehNumeroUtil(venda)) {
        return {
          brlPorUsd: venda,
          dataCotacao: `${d.getUTCFullYear()}-${mm}-${dd}`,
          fonte: "Banco Central (PTAX)",
          obtidoEm: Date.now(),
        };
      }
    } catch {
      // Rede ou timeout: tenta o dia anterior; esgotando, cai no fallback.
    }
  }
  return null;
}

/** Fonte aberta de reserva, usada só quando o BC não responde. */
async function buscarFallback(): Promise<Cotacao | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { BRL?: number } };
    const brl = data.rates?.BRL;
    if (!ehNumeroUtil(brl)) return null;
    return {
      brlPorUsd: brl,
      dataCotacao: new Date().toISOString().slice(0, 10),
      fonte: "exchangerate-api",
      obtidoEm: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * A cotação para usar agora. Devolve null só quando nunca conseguimos
 * nenhuma — aí a tela mostra apenas o valor em dólar.
 */
export async function getCotacaoUsdBrl(): Promise<Cotacao | null> {
  const guardada = configJson.ler<Cotacao | null>(CHAVE, null);
  const fresca = guardada && Date.now() - guardada.obtidoEm < VALIDADE_MS;
  if (guardada && fresca) return guardada;

  const nova = (await buscarPtax()) || (await buscarFallback());
  if (nova) {
    configJson.gravar(CHAVE, nova);
    return nova;
  }
  // As duas fontes falharam: a velha ainda serve, com a data dela à mostra.
  return guardada;
}
