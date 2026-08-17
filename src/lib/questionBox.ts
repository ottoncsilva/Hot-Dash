import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { callAiRaw } from "./ai";
import { getAiCredentials, type AiProvider } from "./settings";
import type { Profile } from "./types";

/**
 * CAIXINHA DE PERGUNTAS — banco de ideias de conteúdo do Instagram, por modelo.
 *
 * São dois tipos, e eles não são a mesma coisa com outro nome:
 *
 *   • CAIXINHA — a pergunta que vai no sticker do story. O vídeo é a RESPOSTA,
 *     e é aí que a conversão acontece: a pergunta existe para dar a deixa de
 *     mostrar algo que sozinho pareceria propaganda.
 *   • DUPLO SENTIDO — a frase que se lê inteira de dois jeitos. Quem só ouve
 *     entende o inocente; quem olha entende o outro. É o formato que passa
 *     pela moderação do Instagram, que é o motivo de ele existir.
 *
 * A geração usa os TRÊS provedores conectados de uma vez, em paralelo, e junta
 * o resultado. Não é redundância: cada modelo tem um vício de escrita, e uma
 * lista inteira saída do mesmo modelo sai com a mesma cara. Se um falhar, os
 * outros dois ainda entregam a leva.
 */

export type QuestionBoxKind = "caixinha" | "duplo_sentido";

export const QUESTION_BOX_KINDS: { key: QuestionBoxKind; label: string; hint: string }[] = [
  {
    key: "caixinha",
    label: "Caixinha de perguntas",
    hint: "A pergunta do sticker + como gravar a resposta em vídeo.",
  },
  {
    key: "duplo_sentido",
    label: "Frases de duplo sentido",
    hint: "A frase que se lê de dois jeitos + a virada que entrega o segundo.",
  },
];

export type QuestionBoxItem = {
  id: string;
  profileId: string;
  kind: QuestionBoxKind;
  text: string;
  idea?: string;
  provider?: string;
  used: boolean;
  usedAt?: number;
  createdAt: number;
};

type Row = {
  id: string;
  profile_id: string;
  kind: string;
  text: string;
  idea: string | null;
  provider: string | null;
  used: number;
  used_at: number | null;
  created_at: number;
};

function toClient(r: Row): QuestionBoxItem {
  return {
    id: r.id,
    profileId: r.profile_id,
    kind: (r.kind === "duplo_sentido" ? "duplo_sentido" : "caixinha") as QuestionBoxKind,
    text: r.text,
    idea: r.idea || undefined,
    provider: r.provider || undefined,
    used: r.used === 1,
    usedAt: r.used_at || undefined,
    createdAt: r.created_at,
  };
}

export function listQuestionBoxItems(profileId: string): QuestionBoxItem[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM question_box_items WHERE profile_id = ?
        ORDER BY used ASC, created_at DESC`,
    )
    .all(profileId) as Row[];
  return rows.map(toClient);
}

export function setQuestionBoxUsed(id: string, used: boolean): QuestionBoxItem | null {
  const db = getDb();
  db.prepare("UPDATE question_box_items SET used = ?, used_at = ? WHERE id = ?").run(
    used ? 1 : 0,
    used ? Date.now() : null,
    id,
  );
  const row = db.prepare("SELECT * FROM question_box_items WHERE id = ?").get(id) as Row | undefined;
  return row ? toClient(row) : null;
}

export function deleteQuestionBoxItem(id: string): void {
  getDb().prepare("DELETE FROM question_box_items WHERE id = ?").run(id);
}

/** Ideia escrita à mão pelo operador — entra na mesma lista das geradas. */
export function addQuestionBoxItem(
  profileId: string,
  kind: QuestionBoxKind,
  text: string,
  idea?: string,
): QuestionBoxItem {
  const item: Row = {
    id: randomUUID(),
    profile_id: profileId,
    kind,
    text: text.trim(),
    idea: (idea || "").trim() || null,
    provider: "manual",
    used: 0,
    used_at: null,
    created_at: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO question_box_items (id, profile_id, kind, text, idea, provider, used, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id, item.profile_id, item.kind, item.text, item.idea,
      item.provider, item.used, item.used_at, item.created_at,
    );
  return toClient(item);
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

/** Quantas ideias cada provedor escreve por rodada. */
const POR_PROVEDOR = 8;
/** Teto por rodada, para uma leva não encher a lista de uma vez. */
const MAX_POR_RODADA = 40;

/**
 * Chave de comparação para não repetir ideia.
 *
 * Sem acento, sem pontuação e sem as palavras de ligação: "o que você faria se
 * eu te chamasse?" e "O QUE VC FARIA, se eu te chamasse..." são a MESMA ideia
 * para quem está lendo o feed, e é assim que a repetição aparece na prática —
 * nunca como duas frases idênticas.
 */
function chave(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bvc\b/g, "voce")
    .replace(/\bpra\b/g, "para")
    .replace(/\bta\b/g, "esta")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Personagem, no mesmo detalhamento que o Método MK usa. */
function persona(p: Profile): string {
  const partes = [p.notes || ""];
  if (p.bioPhysical) partes.push(`Características físicas: ${p.bioPhysical}`);
  if (p.bioUnique) partes.push(`Diferencial/fetiche: ${p.bioUnique}`);
  if (p.bioPersonality) {
    const tipo =
      p.bioPersonality === "santinha"
        ? "Santinha (inocente por fora, safada por dentro)"
        : p.bioPersonality === "explicita"
          ? "Explícita (sem papas na língua, ousada e direta)"
          : "Safadinha (safada na medida)";
    partes.push(`Personalidade/estilo: ${tipo}`);
  }
  return partes.filter(Boolean).join("\n");
}

/**
 * O que a IA recebe.
 *
 * O pedido é de INSTAGRAM, não do Telegram, e a diferença manda no prompt
 * inteiro: lá o conteúdo é o produto e pode ser explícito; aqui é a vitrine, e
 * um story que a moderação derruba não converte nada. Por isso a regra do
 * duplo sentido é explícita — sem palavra proibida, com a malícia na cabeça de
 * quem assiste, não na legenda.
 */
function prompt(p: Profile, kind: QuestionBoxKind, evitar: string[]): string {
  const naoRepetir =
    evitar.length > 0
      ? `\n\nJÁ EXISTEM na lista dela as ideias abaixo. NÃO repita nenhuma, nem uma versão trocando ` +
        `duas palavras — traga ângulos diferentes destes:\n${evitar.map((t) => `- ${t}`).join("\n")}`
      : "";

  const base =
    `Você é o roteirista da influenciadora adulta brasileira "${p.name}", que vende assinatura ` +
    `de conteúdo e usa o Instagram como vitrine.\n\nSOBRE ELA:\n${persona(p) || "(sem descrição)"}\n\n` +
    `REGRAS DO INSTAGRAM (valem para tudo):\n` +
    `- É a VITRINE, não o produto: provoca, não entrega. Nada de nudez nem de palavra explícita ` +
    `(sexo, buceta, pau, gozar, foder). Story derrubado não converte.\n` +
    `- Português do Brasil falado, de quem manda áudio no zap: "tá", "pra", "cê", "né". Nada de ` +
    `tom formal nem de português de Portugal.\n` +
    `- Curto. Ninguém lê story comprido.\n` +
    `- VARIE: cada ideia com uma abertura e um assunto diferentes das outras. Não repita bordão.`;

  const especifico =
    kind === "caixinha"
      ? `\n\nTAREFA: escreva ${POR_PROVEDOR} ideias de CAIXINHA DE PERGUNTAS (o sticker de perguntas do story).\n` +
        `Para cada uma:\n` +
        `- "text": a pergunta EXATA que vai no sticker, escrita como ela escreveria. É a pergunta que ` +
        `ela faz PARA os seguidores, ou o convite para eles perguntarem. Tem que dar vontade de responder ` +
        `sem pensar — curiosa, atrevida, pessoal.\n` +
        `- "idea": como gravar o vídeo da RESPOSTA, em uma ou duas frases. É aqui que está a conversão: ` +
        `diga o enquadramento, o que ela faz enquanto responde e qual é a deixa para puxar o assinante. ` +
        `Formato que funciona: ela lendo a pergunta na tela, reagindo com a cara, e respondendo se ` +
        `arrumando/na cama/saindo do banho — a resposta mostra algo que sozinho pareceria propaganda.`
      : `\n\nTAREFA: escreva ${POR_PROVEDOR} FRASES DE DUPLO SENTIDO para vídeo curto.\n` +
        `A frase tem que ter DUAS leituras honestas: uma inocente, que é a que a legenda entrega, e ` +
        `outra safada, que aparece sozinha na cabeça de quem assiste. A graça é o público sacar; ` +
        `explicar mata.\n` +
        `Para cada uma:\n` +
        `- "text": a frase, do jeito que ela fala no vídeo.\n` +
        `- "idea": a VIRADA — o que aparece na tela que faz a segunda leitura acontecer (o objeto na ` +
        `mão, o corte, a roupa, a pausa, a reação). Uma ou duas frases.\n` +
        `Boas fontes de duplo sentido: comida, esporte/academia, trabalho doméstico, dirigir, ` +
        `tecnologia, animal de estimação. Fuja do trocadilho batido de banana e pepino.`;

  return (
    base +
    especifico +
    naoRepetir +
    `\n\nResponda SÓ um JSON, sem texto antes nem depois, no formato:\n` +
    `{"items":[{"text":"...","idea":"..."}]}`
  );
}

type Bruto = { text?: unknown; idea?: unknown };

function parseItens(raw: string): { text: string; idea: string }[] {
  let dados: unknown;
  try {
    dados = JSON.parse(raw);
  } catch {
    // Alguns modelos embrulham o JSON em ``` mesmo quando se pede que não.
    const m = /\{[\s\S]*\}/.exec(raw || "");
    if (!m) return [];
    try {
      dados = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const lista = (dados as { items?: unknown })?.items;
  if (!Array.isArray(lista)) return [];
  return lista
    .map((x: Bruto) => ({
      text: typeof x?.text === "string" ? x.text.trim() : "",
      idea: typeof x?.idea === "string" ? x.idea.trim() : "",
    }))
    .filter((x) => x.text.length > 0)
    .map((x) => ({ text: x.text.slice(0, 400), idea: x.idea.slice(0, 600) }));
}

export type GeracaoResultado = {
  items: QuestionBoxItem[];
  /** Provedores que responderam, para a tela poder dizer de onde veio a leva. */
  provedores: string[];
  /** Falhas por provedor — a leva continua válida mesmo com uma delas. */
  erros: string[];
};

/**
 * Gera uma leva de ideias e grava as que passarem no filtro de repetição.
 *
 * Roda os provedores EM PARALELO: são três chamadas independentes, e esperar
 * uma para começar a outra triplicaria a espera do operador sem melhorar nada.
 */
export async function gerarIdeias(
  profile: Profile,
  kind: QuestionBoxKind,
): Promise<GeracaoResultado> {
  const provedores: AiProvider[] = (["grok", "gemini", "openai"] as AiProvider[]).filter(
    (p) => getAiCredentials(p, "caixinha") !== null,
  );
  if (provedores.length === 0) {
    throw new Error(
      "Nenhum provedor de IA conectado. Ative um em Configurações → Conexão com IA.",
    );
  }

  // O que já existe entra no prompt como "não repita" E no filtro da volta: o
  // modelo às vezes ignora a instrução, e aí quem segura é o filtro.
  const existentes = listQuestionBoxItems(profile.id).filter((i) => i.kind === kind);
  const vistos = new Set(existentes.map((i) => chave(i.text)));
  // Só as 40 mais recentes vão no prompt: a lista inteira estouraria o pedido
  // e, passando de algumas dezenas, o modelo para de prestar atenção nelas.
  const evitar = existentes.slice(0, 40).map((i) => i.text);
  const pedido = prompt(profile, kind, evitar);

  const respostas = await Promise.all(
    provedores.map(async (p) => {
      try {
        const raw = await callAiRaw(pedido, p, {
          json: true,
          maxTokens: 1800,
          activity: "caixinha",
        });
        return { provider: p, itens: parseItens(raw), erro: null as string | null };
      } catch (e) {
        return {
          provider: p,
          itens: [],
          erro: `${p}: ${e instanceof Error ? e.message : "falha"}`,
        };
      }
    }),
  );

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO question_box_items (id, profile_id, kind, text, idea, provider, used, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
  );

  const novos: QuestionBoxItem[] = [];
  const erros: string[] = [];
  const provedoresOk: string[] = [];
  const agora = Date.now();

  for (const r of respostas) {
    if (r.erro) erros.push(r.erro);
    if (r.itens.length > 0) provedoresOk.push(r.provider);
    for (const item of r.itens) {
      if (novos.length >= MAX_POR_RODADA) break;
      const k = chave(item.text);
      // Repetido — do banco ou de outro provedor desta mesma leva. Os três
      // recebem o mesmo pedido, então esbarrar na mesma ideia é esperado.
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      const id = randomUUID();
      insert.run(id, profile.id, kind, item.text, item.idea || null, r.provider, agora);
      novos.push({
        id,
        profileId: profile.id,
        kind,
        text: item.text,
        idea: item.idea || undefined,
        provider: r.provider,
        used: false,
        createdAt: agora,
      });
    }
  }

  // Todos falharam: isso é erro, não "leva vazia". Sem lançar, a tela diria
  // "0 ideias novas" e o operador ficaria procurando o problema na modelo.
  if (novos.length === 0 && provedoresOk.length === 0 && erros.length > 0) {
    throw new Error(erros.join(" · "));
  }

  return { items: novos, provedores: provedoresOk, erros };
}
