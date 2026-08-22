import "server-only";
import { getAiCredentials } from "./settings";
import {
  modeloImagem,
  resolucaoImagemValida,
  formatoImagemValido,
  tetoReferencias,
  type Formato,
  type ImageResolucao,
} from "./aiMediaOptions";
import { mensagemDeModeracao } from "./aiMediaErros";
import type { PedidoImagem, RespostaImagem } from "./imageGen";
import { MAX_REFERENCIAS } from "./imageGen";

/**
 * GERADOR DE IMAGEM pela BYTEPLUS MODELARK — o Seedream oficial.
 *
 * Além de ser a fonte (a OpenRouter revende), é ele que DESTRAVA a Seedance
 * 2.0 e a 2.5 de lá para retrato: aquelas recusam rosto humano vindo de fora,
 * mas confiam no que a própria ModelArk gerou, na mesma conta, sem edição
 * posterior e dentro de 30 dias.
 *
 * DIFERENTE DA MAGNIFIC: esta API é SÍNCRONA. Devolve as imagens na resposta,
 * sem tarefa nem laço de espera — o mesmo formato que a rota de imagem do
 * painel já esperava. Por isso este módulo é mais simples que o da Magnific.
 */

const BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

function chaveOuFalha(): string {
  const creds = getAiCredentials("byteplus");
  if (!creds) {
    throw new Error(
      "BytePlus não está conectada. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  return creds.apiKey;
}

function mensagemDoErro(status: number, apiMsg: string): string {
  const moderacao = mensagemDeModeracao(apiMsg);
  if (moderacao) return moderacao;
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400:
      return `Pedido recusado pela BytePlus — parâmetro inválido ou imagem fora dos limites${base}.`;
    case 401:
    case 403:
      return "Chave da BytePlus recusada. Confira em Configurações → Conexão com IA.";
    case 404:
      return "Modelo não encontrado na BytePlus.";
    case 429:
      return "Muitos pedidos em sequência — aguarde um instante e tente de novo.";
    default:
      return `Falha na BytePlus (${status})${base}.`;
  }
}

/**
 * O TOTAL DE PIXELS de cada degrau, que é o que a BytePlus usa como âncora.
 *
 * Ela oferece dois jeitos de pedir o tamanho: o degrau ("2K") ou a dimensão
 * exata ("2048x2048") — e os dois NÃO podem vir juntos. O degrau sozinho
 * deixa o modelo escolher a proporção a partir do texto do prompt, o que
 * tornaria o seletor de formato da tela decorativo. Então calculamos a
 * dimensão: área do degrau, na proporção escolhida.
 */
const PIXELS_DO_DEGRAU: Record<ImageResolucao, number> = {
  "1K": 1024 * 1024,
  "2K": 2048 * 2048,
  "4K": 4096 * 4096,
};

const PROPORCAO: Record<Formato, [number, number]> = {
  "1:1": [1, 1],
  "3:4": [3, 4],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "16:9": [16, 9],
};

/** `largura x altura` com a área do degrau e a proporção pedida. */
export function tamanhoByteplus(resolucao: ImageResolucao, formato: Formato): string {
  const area = PIXELS_DO_DEGRAU[resolucao];
  const [a, b] = PROPORCAO[formato];
  // Múltiplos de 16: é o alinhamento que os modelos de difusão esperam, e
  // arredondar aqui evita que a API recuse uma dimensão ímpar.
  const arredondar = (n: number) => Math.max(512, Math.round(n / 16) * 16);
  return `${arredondar(Math.sqrt((area * a) / b))}x${arredondar(Math.sqrt((area * b) / a))}`;
}

/**
 * O degrau no vocabulário da BytePlus, quando o formato não é escolhível.
 * O 5.0 Pro tem 1.5K, que custa o mesmo que o 1K e sai melhor — então "1K"
 * na tela vira 1.5K no pedido.
 */
function degrauByteplus(resolucao: ImageResolucao, slug: string): string {
  if (slug.includes("5-0-pro") && resolucao === "1K") return "1.5K";
  return resolucao;
}

export async function gerarImagemByteplus(pedido: PedidoImagem): Promise<RespostaImagem> {
  const apiKey = chaveOuFalha();
  const modelo = modeloImagem(pedido.modelo);

  const teto = tetoReferencias(modelo.id, MAX_REFERENCIAS);
  const referencias = pedido.referencias.slice(0, teto);

  const resolucao = resolucaoImagemValida(modelo.id, pedido.resolution);
  const formato = formatoImagemValido(modelo.id, pedido.aspectRatio);
  const n = Math.min(modelo.maxN, Math.max(1, Math.round(pedido.quantidade || 1)));

  const body: Record<string, unknown> = {
    model: modelo.slug,
    prompt: pedido.prompt,
    size: tamanhoByteplus(resolucao, formato),
    // Base64 direto na resposta: é o que a rota do painel devolve ao
    // navegador. Pedir `url` obrigaria um download a mais, e o link da
    // BytePlus só vale 24 horas.
    response_format: "b64_json",
    // A plataforma marca a imagem por padrão. Foto de venda com selo de IA
    // não serve — o painel manda desligado sempre.
    watermark: false,
  };
  if (referencias.length === 1) {
    body.image = referencias[0];
  } else if (referencias.length > 1) {
    body.image = referencias;
  }
  if (n > 1) {
    // Várias imagens numa chamada só, em vez de chamadas repetidas.
    body.sequential_image_generation = "auto";
    body.sequential_image_generation_options = { max_images: n };
  }
  if (typeof pedido.seed === "number" && Number.isFinite(pedido.seed)) {
    body.seed = Math.round(pedido.seed);
  }
  // `degrauByteplus` fica registrado mesmo sem uso no corpo: é a tradução
  // certa caso um dia o formato passe a sair do prompt em vez da dimensão.
  void degrauByteplus;

  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    const msg =
      (typeof err?.message === "string" && err.message) ||
      (typeof data.message === "string" && data.message) ||
      "";
    throw new Error(mensagemDoErro(res.status, msg));
  }

  const itens = (data.data as { b64_json?: string; url?: string }[] | undefined) || [];
  const imagens: { base64: string; mediaType: string }[] = [];
  for (const i of itens) {
    if (typeof i?.b64_json === "string" && i.b64_json) {
      imagens.push({ base64: i.b64_json, mediaType: "image/jpeg" });
      continue;
    }
    // Rede de segurança: se vier link em vez de base64, buscamos aqui — a URL
    // da BytePlus expira em 24h e o navegador nunca deveria depender dela.
    if (typeof i?.url === "string" && i.url) {
      const r = await fetch(i.url, { redirect: "follow" });
      if (!r.ok) continue;
      imagens.push({
        base64: Buffer.from(await r.arrayBuffer()).toString("base64"),
        mediaType: r.headers.get("content-type") || "image/jpeg",
      });
    }
  }
  if (imagens.length === 0) throw new Error("A BytePlus não devolveu imagem nenhuma.");

  // Sem `costUsd`: a BytePlus cobra por token consumido e não devolve o valor
  // em dólar aqui.
  return { imagens };
}
