import "server-only";
import { getAiCredentials, type AiProvider } from "./settings";
import { NETWORK_LABELS, type SocialNetwork } from "./types";

/**
 * Gerador de legendas por IA, sem SDKs (REST puro via fetch), no mesmo
 * espírito de googleSheets.ts/syncpay.ts. O provedor (OpenAI ou Google
 * Gemini) é escolhido pelo usuário na hora de cada atividade — o modelo e a
 * chave vêm das Configurações — a chave fica criptografada (AES-256) no banco.
 */

export type CaptionRequest = {
  provider: AiProvider;
  networks: { network: SocialNetwork; postType: string }[];
  profileName: string;
  profileNotes?: string;
  /** Tema/instruções livres do usuário (ex.: "foto na praia ao pôr do sol"). */
  theme: string;
};

function buildPrompt(req: CaptionRequest): string {
  const alvos = req.networks
    .map((n) => `${NETWORK_LABELS[n.network] || n.network} (${n.postType})`)
    .join(", ");
  return [
    `Você é social media da influenciadora "${req.profileName}".`,
    req.profileNotes ? `Sobre a personagem: ${req.profileNotes}` : "",
    `Escreva UMA legenda em português do Brasil para: ${alvos}.`,
    `Tema/contexto do post: ${req.theme}`,
    "Regras:",
    "- Tom envolvente e autêntico, na voz da personagem (primeira pessoa).",
    "- Use emojis com moderação e inclua 3 a 6 hashtags relevantes no final.",
    "- Se for Stories ou mensagem, seja curta e direta; se for Feed/Reels, pode desenvolver um pouco mais.",
    "- Responda SOMENTE com o texto da legenda, sem aspas nem explicações.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateCaption(req: CaptionRequest): Promise<string> {
  return (await callAiRaw(buildPrompt(req), req.provider)).trim();
}

/**
 * Chama o provedor de IA pedido (OpenAI ou Google Gemini) e devolve o texto
 * bruto da resposta. Compartilhado entre o gerador de legenda e o gerador de
 * cronograma — cada um monta seu próprio prompt e interpreta a resposta do
 * seu jeito (texto livre vs. JSON estruturado).
 */
export async function callAiRaw(
  prompt: string,
  provider: AiProvider,
  opts?: { json?: boolean; maxTokens?: number },
): Promise<string> {
  const creds = getAiCredentials(provider);
  if (!creds) {
    const label = provider === "openai" ? "OpenAI" : "Google Gemini";
    throw new Error(
      `${label} não está conectado: ative e cole a chave de API em Configurações → Conexão com IA.`,
    );
  }
  const maxTokens = opts?.maxTokens ?? 500;

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: maxTokens,
        ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = ((data.error as Record<string, unknown>)?.message as string) || "";
      throw new Error(`OpenAI (${res.status}): ${msg || "falha ao gerar conteúdo"}`);
    }
    const text = (data.choices as { message?: { content?: string } }[])?.[0]?.message
      ?.content;
    if (!text) throw new Error("OpenAI não retornou texto.");
    return text;
  }

  // Google Gemini
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      creds.model,
    )}:generateContent?key=${encodeURIComponent(creds.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: maxTokens,
          ...(opts?.json ? { responseMimeType: "application/json" } : {}),
        },
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
  provider: AiProvider,
  apiKey: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true };
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const msg = ((data.error as Record<string, unknown>)?.message as string) || `erro ${res.status}`;
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
