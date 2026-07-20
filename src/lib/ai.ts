import "server-only";
import { getAiCredentials, type AiProvider } from "./settings";
import { NETWORK_LABELS, type SocialNetwork } from "./types";

/**
 * Gerador de legendas por IA, sem SDKs (REST puro via fetch), no mesmo
 * espírito de syncpay.ts. O provedor (OpenAI ou Google Gemini) é escolhido
 * pelo usuário na hora de cada atividade — o modelo e a chave vêm das
 * Configurações — a chave fica criptografada (AES-256) no banco.
 */

/** Imagem embutida (base64) para a IA analisar — só usado pelo post manual. */
export type CaptionImage = { mime: string; base64: string };

export type CaptionRequest = {
  provider: AiProvider;
  networks: { network: SocialNetwork; postType: string }[];
  profileName: string;
  profileNotes?: string;
  /** Contexto extra opcional do usuário (ex.: "tom provocante"). */
  theme?: string;
  /** Mídia(s) selecionada(s) — quando presente, a IA analisa a imagem de verdade. */
  images?: CaptionImage[];
};

function buildPrompt(req: CaptionRequest): string {
  const alvos = req.networks
    .map((n) => `${NETWORK_LABELS[n.network] || n.network} (${n.postType})`)
    .join(", ");
  const hasImages = Boolean(req.images && req.images.length > 0);
  const instructions = (req.theme || "").trim();
  const hasInstructions = instructions.length > 0;
  return [
    `Você é social media da influenciadora "${req.profileName}".`,
    req.profileNotes ? `Sobre a personagem: ${req.profileNotes}` : "",
    `Escreva UMA legenda em português do Brasil para: ${alvos}.`,
    // As instruções do usuário definem o TOM e o ESTILO. Os modelos/exemplos que
    // elas contêm servem de REFERÊNCIA — não devem ser copiados ao pé da letra,
    // senão toda legenda sai igual (mesma abertura, mesma estrutura). Deixamos
    // isso explícito para o modelo se inspirar no estilo, mas variar o texto.
    hasInstructions
      ? `INSTRUÇÕES DO USUÁRIO (definem o TOM e o ESTILO desejados). Se houver legendas de exemplo, use-as APENAS como referência de estilo/vocabulário — NÃO as copie, crie uma legenda nova e diferente:\n${instructions}`
      : "",
    hasImages
      ? "Baseie a legenda no que aparece NESTA imagem específica (cenário, roupa, pose, expressão, detalhes) — cada foto é diferente, então cada legenda deve ser diferente."
      : hasInstructions
        ? ""
        : "Crie uma legenda natural e envolvente para o post.",
    "Regras gerais (as INSTRUÇÕES DO USUÁRIO acima têm prioridade sobre estas):",
    "- Tom envolvente e autêntico, na voz da personagem (primeira pessoa).",
    "- VARIE bastante: mude a frase de abertura, a estrutura e as palavras a cada legenda. Nunca comece duas legendas da mesma forma nem repita bordões.",
    "- Use emojis com moderação.",
    "- Em redes de feed (Instagram/TikTok) pode incluir 3 a 6 hashtags relevantes no final; em Telegram e mensagens diretas NÃO use hashtags.",
    "- Se for Stories ou mensagem, seja curta e direta; se for Feed/Reels, pode desenvolver um pouco mais.",
    "- Responda SOMENTE com o texto da legenda, sem aspas nem explicações.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateCaption(req: CaptionRequest): Promise<string> {
  return (
    await callAiRaw(buildPrompt(req), req.provider, { images: req.images })
  ).trim();
}

/**
 * Chama o provedor de IA pedido (OpenAI ou Google Gemini) e devolve o texto
 * bruto da resposta. Compartilhado entre o gerador de legenda e o gerador de
 * cronograma — cada um monta seu próprio prompt e interpreta a resposta do
 * seu jeito (texto livre vs. JSON estruturado). `opts.images`, quando
 * presente, envia a mídia junto (visão) — só o gerador de legenda do post
 * manual usa isso; o gerador de cronograma em lote nunca passa imagens.
 */
export async function callAiRaw(
  prompt: string,
  provider: AiProvider,
  opts?: { json?: boolean; maxTokens?: number; images?: CaptionImage[] },
): Promise<string> {
  const creds = getAiCredentials(provider);
  if (!creds) {
    const label = provider === "openai" ? "OpenAI" : provider === "grok" ? "Grok (x.ai)" : "Google Gemini";
    throw new Error(
      `${label} não está conectado: ative e cole a chave de API em Configurações → Conexão com IA.`,
    );
  }
  const maxTokens = opts?.maxTokens ?? 500;
  const images = opts?.images || [];

  // OpenAI e Grok (x.ai) compartilham o mesmo formato de API (chat/completions),
  // mudando apenas a URL base — por isso são tratados no mesmo ramo.
  if (provider === "openai" || provider === "grok") {
    const content =
      images.length > 0
        ? [
            { type: "text", text: prompt },
            ...images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ]
        : prompt;

    // Alguns modelos (família "reasoning": o1/o3/o4, gpt-5...) rejeitam
    // `max_tokens` (exigem `max_completion_tokens`) e/ou `temperature`
    // diferente do padrão. Em vez de adivinhar pelo nome do modelo (a lista
    // de modelos é sempre ao vivo, nunca hardcoded), tenta o request normal
    // e, se a OpenAI reclamar de um desses parâmetros especificamente,
    // ajusta e tenta de novo uma única vez.
    function buildBody(opts_: { dropTemperature?: boolean; useMaxCompletionTokens?: boolean }) {
      return {
        model: creds!.model,
        messages: [{ role: "user", content }],
        ...(opts_.dropTemperature ? {} : { temperature: 0.9 }),
        ...(opts_.useMaxCompletionTokens
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
        ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
      };
    }

    async function attempt(body: Record<string, unknown>) {
      const defaultUrl =
        provider === "grok"
          ? "https://api.x.ai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
      const url = creds!.baseUrl || defaultUrl;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds!.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { res, data };
    }

    let { res, data } = await attempt(buildBody({}));
    if (!res.ok) {
      const errObj = data.error as Record<string, unknown> | undefined;
      const param = (errObj?.param as string) || "";
      const msg = (errObj?.message as string) || "";
      const badParam = (name: string) => param === name || msg.includes(`'${name}'`);
      if (res.status === 400 && (badParam("max_tokens") || badParam("temperature"))) {
        ({ res, data } = await attempt(
          buildBody({
            dropTemperature: badParam("temperature"),
            useMaxCompletionTokens: badParam("max_tokens"),
          }),
        ));
      }
    }
    const providerLabel = provider === "grok" ? "Grok" : "OpenAI";
    if (!res.ok) {
      const errObj = data.error;
      const msg = (typeof errObj === 'string' ? errObj : (errObj as Record<string, unknown>)?.message as string) || "";
      throw new Error(`${providerLabel} (${res.status}): ${msg || "falha ao gerar conteúdo"}`);
    }
    const text = (data.choices as { message?: { content?: string } }[])?.[0]?.message
      ?.content;
    if (!text) throw new Error(`${providerLabel} não retornou texto.`);
    return text;
  }

  // Google Gemini
  const parts: Record<string, unknown>[] = [
    { text: prompt },
    ...images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.base64 } })),
  ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      creds.model,
    )}:generateContent?key=${encodeURIComponent(creds.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: maxTokens,
          ...(opts?.json ? { responseMimeType: "application/json" } : {}),
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = ((data.error as Record<string, unknown>)?.message as string) || "";
    throw new Error(`Gemini (${res.status}): ${msg || "falha ao gerar conteúdo"}`);
  }
  const text = (
    data.candidates as { content?: { parts?: { text?: string }[] } }[]
  )?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini não retornou texto.");
  return text;
}

/**
 * Testa uma chave de API contra o provedor, sem gerar nenhum conteúdo —
 * só confirma que a chave é válida (chamada leve de listagem de modelos).
 */
export async function testAiProviderKey(
  provider: AiProvider | "grok" | "sightengine",
  apiKey: string,
  opts?: { baseUrl?: string; apiUser?: string }
): Promise<{ ok: boolean; message?: string }> {
  try {
    if (provider === "openai" || provider === "grok") {
      const url = opts?.baseUrl ? opts.baseUrl.replace(/\/chat\/completions$/, "") + "/models" : provider === "grok" ? "https://api.x.ai/v1/models" : "https://api.openai.com/v1/models";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true };
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const errObj = data.error;
      const msg = (typeof errObj === 'string' ? errObj : (errObj as Record<string, unknown>)?.message as string) || `erro ${res.status}`;
      return { ok: false, message: msg };
    }
    if (provider === "sightengine") {
      if (!opts?.apiUser) return { ok: false, message: "Falta API User." };
      const res = await fetch(`https://api.sightengine.com/1.0/check.json?models=nudity-2.0&api_user=${encodeURIComponent(opts.apiUser)}&api_secret=${encodeURIComponent(apiKey)}`);
      const data = await res.json().catch(() => ({}));
      if (data.status === "success") return { ok: true };
      return { ok: false, message: data.error?.message || "Erro na validação" };
    }
    if (provider === "magnific") {
      const res = await fetch("https://api.magnific.com/v1/analytics/team-api-keys", {
        headers: { "x-magnific-api-key": apiKey },
      });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      const msg = data.error?.message || `erro ${res.status}`;
      return { ok: false, message: msg };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    );
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = ((data.error as Record<string, unknown>)?.message as string) || `erro ${res.status}`;
    return { ok: false, message: msg };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "falha de rede" };
  }
}

// Prefixos de modelos de chat/completions da OpenAI (a API não expõe um
// campo de capacidade, então o filtro é por prefixo + exclusão de variantes
// não usáveis aqui — áudio, transcrição, embeddings, imagem, etc).
const OPENAI_CHAT_PREFIXES = ["gpt-", "o1", "o3", "o4", "chatgpt-"];
const OPENAI_DENYLIST_SUBSTRINGS = [
  "audio",
  "realtime",
  "transcribe",
  "search",
  "instruct",
  "moderation",
  "embedding",
  "image",
  "computer-use",
  "tts",
  "whisper",
  "dall-e",
];

function filterOpenAiChatModels(raw: { id: string; created?: number }[]): string[] {
  return raw
    .filter((m) => typeof m.id === "string")
    .filter((m) => OPENAI_CHAT_PREFIXES.some((p) => m.id.startsWith(p)))
    .filter((m) => !OPENAI_DENYLIST_SUBSTRINGS.some((s) => m.id.includes(s)))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((m) => m.id);
}

/** Extrai a primeira versão numérica do id (ex.: "gemini-2.5-flash" -> 2.5) para ordenar. */
function extractVersion(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function filterGeminiChatModels(
  raw: { name: string; supportedGenerationMethods?: string[] }[],
): string[] {
  return raw
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort((a, b) => extractVersion(b) - extractVersion(a));
}

/**
 * Lista os modelos de chat/geração disponíveis para a chave informada.
 * Nunca lança — sempre resolve com {ok:false, message} em caso de erro,
 * para o caller poder cair no fallback estático com segurança.
 */
export async function listAiModels(
  provider: AiProvider,
  apiKey: string,
): Promise<{ ok: boolean; models?: string[]; message?: string }> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const errObj = data.error;
        const msg = (typeof errObj === 'string' ? errObj : (errObj as Record<string, unknown>)?.message as string) || `erro ${res.status}`;
        return { ok: false, message: msg };
      }
      const raw = (data.data as { id: string; created?: number }[]) || [];
      return { ok: true, models: filterOpenAiChatModels(raw) };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = ((data.error as Record<string, unknown>)?.message as string) || `erro ${res.status}`;
      return { ok: false, message: msg };
    }
    const raw = (data.models as { name: string; supportedGenerationMethods?: string[] }[]) || [];
    return { ok: true, models: filterGeminiChatModels(raw) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "falha de rede" };
  }
}
