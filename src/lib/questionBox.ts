import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { callAiRaw } from "./ai";
import { getAiCredentials, type AiProvider } from "./settings";
import type { Profile } from "./types";
import { CAIXINHAS_VALIDADAS, type ExemploCaixinha } from "./caixinhaExemplos";

/**
 * CAIXINHA DE PERGUNTAS — banco de ideias de conteúdo do Instagram, por modelo.
 *
 * São dois tipos, e eles não são a mesma coisa com outro nome:
 *
 *   • CAIXINHA — um par PERGUNTA + RESPOSTA. A pergunta vem escrita como um
 *     seguidor mandaria; a resposta é dela, com o duplo sentido em cima das
 *     metáforas do personagem. Os dois juntos cabem em 140–160 caracteres, que
 *     é a régua da caixinha: resposta que não cabe na tela não é lida.
 *   • DUPLO SENTIDO — a frase de vídeo que se lê inteira de dois jeitos, mais a
 *     virada: o que aparece na tela que faz a segunda leitura acontecer.
 *
 * A geração usa os TRÊS provedores conectados de uma vez, em paralelo, e junta
 * o resultado. Não é redundância: cada modelo tem um vício de escrita, e uma
 * lista inteira saída do mesmo modelo sai com a mesma cara. Por isso são poucos
 * pares por provedor em vez de muitos de um só. Se um falhar, os outros dois
 * ainda entregam a leva.
 */

export type QuestionBoxKind = "caixinha" | "duplo_sentido";

/** Os provedores que escrevem a caixinha, na ordem em que a tela os mostra. */
export const PROVEDORES: AiProvider[] = ["grok", "gemini", "openai"];

export const QUESTION_BOX_KINDS: { key: QuestionBoxKind; label: string; hint: string }[] = [
  {
    key: "caixinha",
    label: "Caixinha de perguntas",
    hint: "Pergunta de seguidor + a resposta dela, em 140–160 caracteres.",
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
  /** Personagem daquela leva ("massagista morena de 20 anos"). */
  theme?: string;
  /** Duração estimada do vídeo, em segundos. */
  seconds?: number;
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
  theme: string | null;
  seconds: number | null;
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
    theme: r.theme || undefined,
    seconds: r.seconds || undefined,
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
  tema?: string,
): QuestionBoxItem {
  const item: Row = {
    id: randomUUID(),
    profile_id: profileId,
    kind,
    text: text.trim(),
    idea: (idea || "").trim() || null,
    theme: (tema || "").trim() || null,
    seconds: segundosDoTexto(text, idea),
    provider: "manual",
    used: 0,
    used_at: null,
    created_at: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO question_box_items (id, profile_id, kind, text, idea, theme, seconds, provider, used, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id, item.profile_id, item.kind, item.text, item.idea, item.theme,
      item.seconds, item.provider, item.used, item.used_at, item.created_at,
    );
  return toClient(item);
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

/**
 * Quantos pares cada provedor escreve por clique.
 *
 * TRÊS, e a conta é essa mesmo: com os três provedores conectados são 9 por
 * rodada. Poucos e de fontes diferentes rende mais ângulo do que muitos do
 * mesmo modelo — depois do quinto item de uma mesma resposta, o modelo já está
 * variando a mesma ideia.
 */
const POR_PROVEDOR = 3;
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

/**
 * Duração estimada do vídeo a partir do TEXTO — a reserva de quando a IA não
 * manda o número, ou manda um absurdo.
 *
 * A conta é a velocidade de fala: ~2,5 palavras por segundo em conversa
 * brasileira normal, mais 3 segundos fixos para o começo (ela lendo a pergunta
 * na tela, a reação) e o fim (a pausa antes de cortar). O piso de 6s existe
 * porque story mais curto que isso ninguém termina de ler.
 *
 * Ficar sem número não é opção: quem monta a sequência do dia precisa saber se
 * a ideia é de 8s ou de 40s ANTES de gravar.
 */
function segundosDoTexto(pergunta: string, resposta?: string): number {
  const palavras = `${pergunta} ${resposta || ""}`.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(6, Math.min(90, Math.round(palavras / 2.5) + 3));
}

/**
 * A PERSONA vem do cadastro da modelo — Modelos → editar → Perfil da modelo.
 *
 * É o mesmo cadastro que alimenta o Método MK, e os rótulos aqui são os mesmos
 * da tela de lá de propósito: quem escreve "Coroa 40 anos, divorciada" no campo
 * "Mecanismo único / fetiche" precisa reconhecer aquele texto no que a IA
 * recebe. Rótulo diferente entre a tela e o prompt é o tipo de divergência que
 * faz o operador achar que o campo não está sendo usado.
 */
export function personaDaModelo(p: Profile): string {
  const partes: string[] = [`Nome: ${p.name}`];
  if (p.bioPhysical) partes.push(`Características físicas: ${p.bioPhysical}`);
  if (p.bioUnique) partes.push(`Mecanismo único / fetiche (o diferencial): ${p.bioUnique}`);
  if (p.bioPersonality) {
    const tipo =
      p.bioPersonality === "santinha"
        ? "Santinha (inocente por fora)"
        : p.bioPersonality === "explicita"
          ? "Explícita (sem papas na língua)"
          : "Safadinha (safada na medida)";
    partes.push(`Como ela é: ${tipo}`);
  }
  if (p.notes?.trim()) partes.push(`Anotações: ${p.notes.trim()}`);
  return partes.join("\n");
}

/**
 * Sorteia exemplos da lista validada (lib/caixinhaExemplos.ts) para o pedido.
 *
 * Não vai a lista inteira: duzentos exemplos afogam o prompt e o modelo para
 * de lê-los. Sorteando, cada provedor e cada leva veem cantos diferentes do
 * repertório — que é de onde sai a variedade de ângulo.
 */
function exemplos(quantos: number): ExemploCaixinha[] {
  const baralho = [...CAIXINHAS_VALIDADAS];
  for (let k = baralho.length - 1; k > 0; k--) {
    const m = Math.floor(Math.random() * (k + 1));
    [baralho[k], baralho[m]] = [baralho[m], baralho[k]];
  }
  return baralho.slice(0, quantos);
}

/**
 * Teto do par pergunta + resposta.
 *
 * Não há PISO. As caixinhas validadas vão de "Você tá usando fio dental? Tô"
 * a respostas de três linhas, e as curtas estão entre as que mais funcionam —
 * exigir um mínimo só produziria enrolação para preencher cota. O teto
 * continua porque resposta que não cabe na tela do story não é lida.
 */
export const TAMANHO_MAX = 200;

/**
 * O que a IA recebe.
 *
 * O pedido é de INSTAGRAM, não do Telegram, e a diferença manda no prompt
 * inteiro: lá o conteúdo é o produto e pode ser explícito; aqui é a vitrine, e
 * um story que a moderação derruba não converte nada. Por isso a regra é
 * explícita — sem palavra proibida, com a malícia na cabeça de quem assiste,
 * não escrita na tela.
 *
 * `tema` é o que o operador digita antes de gerar ("massagista morena de 20
 * anos", "professora", "ruiva bem vermelhinha"). É o campo que mais muda o
 * resultado: é dele que saem as metáforas, e metáfora de profissão é o que faz
 * o duplo sentido funcionar sem palavra proibida.
 */
function prompt(p: Profile, kind: QuestionBoxKind, tema: string, evitar: string[]): string {
  const naoRepetir =
    evitar.length > 0
      ? `\n\nJÁ EXISTEM na lista dela as ideias abaixo. NÃO repita nenhuma, nem uma versão trocando ` +
        `duas palavras — traga ângulos diferentes destes:\n${evitar.map((t) => `- ${t}`).join("\n")}`
      : "";

  // A observação extra vem DEPOIS da persona e antes das regras: é um recorte
  // de assunto ("hoje ela é professora", "fala do calor"), não uma troca de
  // personagem — quem é a modelo já veio do cadastro dela.
  const extra = tema.trim()
    ? `\nOBSERVAÇÃO PARA ESTA LEVA (o assunto de hoje): ${tema.trim()}\n`
    : "";

  const base =
    `Você é o roteirista da influenciadora adulta brasileira "${p.name}", que vende assinatura ` +
    `de conteúdo e usa o Instagram como vitrine.\n\n` +
    `SOBRE ELA (cadastro da modelo — é ESTA a personagem, não invente outra):\n` +
    `${personaDaModelo(p)}\n${extra}\n` +
    `TOM: safada, engraçada e sem cerimônia. Ela não se faz de tímida — responde na lata, devolve ` +
    `a provocação e ri junto. O humor é o que segura: uma resposta que só é sensual soa ` +
    `propaganda; uma que faz rir e ainda provoca é a que roda.\n\n` +
    `COMO ESCREVER O EXPLÍCITO — a regra mais importante:\n` +
    `O conteúdo é adulto e direto, MAS a palavra nunca vai inteira e limpa, senão o Instagram ` +
    `derruba o story. Sempre uma destas três saídas:\n` +
    `  1. MASCARE a palavra trocando letras: c*zinho, p4u, b*ceta, g0zar, f0der, leit3, m4mar, ` +
    `jat*d4, g3mendo.\n` +
    `  2. USE O EMOJI no lugar dela: 👌🏼 🍑 🆒 🍩 (atrás) · 🌸 🐸 (na frente) · 💦 🍼 (leite) · ` +
    `💍 (anel).\n` +
    `  3. USE O APELIDO: portinha dos fundos, porta da frente, apertadinho, malaquias, boneco, ` +
    `brinquedo, caneco, garagem, melzinho, bonequinha.\n` +
    `Escrever a palavra inteira e limpa é o único erro que não tem conserto.\n\n` +
    `REGRAS DE ESCRITA:\n` +
    `- Português do Brasil FALADO, de quem manda áudio no zap: "tá", "pra", "cê", "né", "amor". ` +
    `Nada de tom formal, de vírgula caprichada nem de português de Portugal.\n` +
    `- CURTO. Muitas das melhores têm uma frase só. Nada de introdução, de explicar a piada nem ` +
    `de enrolar para chegar no ponto.\n` +
    `- VARIE: cada ideia com uma abertura e um assunto diferentes das outras. Não repita bordão.`;

  const especifico =
    kind === "caixinha"
      ? `\n\nTAREFA: escreva ${POR_PROVEDOR} pares PERGUNTA + RESPOSTA para a caixinha de perguntas ` +
        `do story.\n` +
        `- "pergunta": escrita como um SEGUIDOR HOMEM mandou de verdade — atrevido, direto, sem ` +
        `formalidade, sem acento e sem capricho de pontuação, às vezes com um erro de digitação. ` +
        `É ELE quem escreve, não ela. Muitas vêm com gracinha, cantada ou vantagem ("tenho 18cm", ` +
        `"minha mulher acha pequeno") — é justamente isso que dá o gancho da resposta.\n` +
        `- "resposta": ela respondendo. Escolha para cada par UM dos quatro jeitos que funcionam, ` +
        `e não repita o mesmo jeito duas vezes seguidas:\n` +
        `    • DEVOLVE — o seguidor veio com gracinha e ela rebate mais forte, virando a piada ` +
        `contra ele;\n` +
        `    • FINGE QUE NÃO ENTENDE — a ingenuidade fingida é a piada;\n` +
        `    • RESPONDE SECO — uma ou duas palavras, e o choque está na naturalidade;\n` +
        `    • TOPA E AUMENTA — aceita a proposta e sobe a aposta, com uma condição divertida.\n` +
        `  O emoji no fim é opcional: use quando cair bem, não como carimbo.\n` +
        `- "segundos": quantos segundos o vídeo dessa resposta dura, gravado em ritmo de conversa ` +
        `(ela lendo a pergunta na tela, reagindo e respondendo). Só o número.\n` +
        `- TAMANHO: pergunta + resposta somadas, no MÁXIMO ${TAMANHO_MAX} caracteres. Não há ` +
        `mínimo — as curtas estão entre as que mais funcionam.\n\n` +
        `CAIXINHAS QUE JÁ RODARAM NESTE PERFIL. É esta a voz: o vocabulário, a grafia mascarada, ` +
        `o tamanho e o tipo de piada. NÃO copie nenhuma delas nem uma versão trocando duas ` +
        `palavras — escreva novas com este mesmo sangue:\n` +
        exemplos(14)
          .map(([q, a]) => `P: ${q}\nR: ${a}`)
          .join("\n\n")
      : `\n\nTAREFA: escreva ${POR_PROVEDOR} FRASES DE DUPLO SENTIDO para vídeo curto.\n` +
        `A frase tem que ter DUAS leituras honestas: uma inocente, que é a que a legenda entrega, e ` +
        `outra safada, que aparece sozinha na cabeça de quem assiste. A graça é o público sacar; ` +
        `explicar mata.\n` +
        `- "frase": o que ela fala no vídeo, do jeito que ela fala. Pode terminar com um emoji leve ` +
        `(😏 🔥 💋 💦 🍑).\n` +
        `- "virada": o que aparece na TELA que faz a segunda leitura acontecer (o objeto na mão, o ` +
        `corte, a roupa, a pausa, a reação). Uma ou duas frases.\n` +
        `- "segundos": quantos segundos o vídeo dura, do começo da frase até a virada. Só o número.\n` +
        `Boas fontes de duplo sentido: comida, esporte/academia, trabalho doméstico, dirigir, ` +
        `tecnologia, animal de estimação — e o universo do personagem desta leva. Fuja do trocadilho ` +
        `batido de banana e pepino.\n\n` +
        `A VOZ DELA é a mesma das caixinhas que já rodaram aqui. Repare no vocabulário, na grafia ` +
        `mascarada e no tipo de piada — não copie o assunto, copie o sangue:\n` +
        exemplos(8)
          .map(([q, a]) => `P: ${q}\nR: ${a}`)
          .join("\n\n");

  // O FORMATO fica por último, depois da lista do "não repita". Modelo obedece
  // melhor a última instrução que leu, e formato errado perde a leva inteira —
  // enquanto uma repetição a mais o filtro da volta ainda segura.
  const formato =
    kind === "caixinha"
      ? `{"items":[{"pergunta":"...","resposta":"...","segundos":12}]}`
      : `{"items":[{"frase":"...","virada":"...","segundos":10}]}`;

  return (
    base +
    especifico +
    naoRepetir +
    `\n\nResponda SÓ um JSON, sem texto antes nem depois:\n${formato}`
  );
}

/**
 * Lê a resposta do modelo.
 *
 * As chaves são pedidas em PORTUGUÊS e por tipo ("pergunta"/"resposta",
 * "frase"/"virada") porque nomear o campo com o que ele é melhora o que vem
 * dentro dele — "text" aceita qualquer coisa, "pergunta" cobra uma pergunta.
 * Mas os três provedores erram a chave de vez em quando, então todas as
 * variações são aceitas na volta: perder uma leva inteira por causa do nome de
 * um campo seria o pior tipo de falha.
 */
function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Segundos, com sanidade: fora de 3–120 é chute do modelo, não estimativa. */
function segundos(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= 3 && n <= 120 ? Math.round(n) : 0;
}

function parseItens(raw: string): { text: string; idea: string; segundos: number }[] {
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
    .map((x: Record<string, unknown>) => ({
      text: texto(x?.pergunta) || texto(x?.frase) || texto(x?.text),
      idea: texto(x?.resposta) || texto(x?.virada) || texto(x?.idea),
      segundos: segundos(x?.segundos ?? x?.seconds ?? x?.duracao),
    }))
    .filter((x) => x.text.length > 0)
    .map((x) => ({
      text: x.text.slice(0, 400),
      idea: x.idea.slice(0, 600),
      segundos: x.segundos,
    }));
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
  tema = "",
  escolhidos?: string[],
): Promise<GeracaoResultado> {
  // Quem a tela pediu, cruzado com quem está de fato conectado — pedir a um
  // provedor sem chave só produziria um erro por leva. Sem escolha, valem os
  // três.
  const pedidos = escolhidos?.length ? escolhidos : PROVEDORES;
  const provedores: AiProvider[] = PROVEDORES.filter(
    (p) => pedidos.includes(p) && getAiCredentials(p, "caixinha") !== null,
  );
  if (provedores.length === 0) {
    throw new Error(
      "Nenhum provedor de IA conectado entre os escolhidos. Ative um em Configurações → Conexão com IA.",
    );
  }

  // O que já existe entra no prompt como "não repita" E no filtro da volta: o
  // modelo às vezes ignora a instrução, e aí quem segura é o filtro.
  const existentes = listQuestionBoxItems(profile.id).filter((i) => i.kind === kind);
  const vistos = new Set(existentes.map((i) => chave(i.text)));
  // Só as 40 mais recentes vão no prompt: a lista inteira estouraria o pedido
  // e, passando de algumas dezenas, o modelo para de prestar atenção nelas.
  const evitar = existentes.slice(0, 40).map((i) => i.text);
  const pedido = prompt(profile, kind, tema, evitar);

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
    `INSERT INTO question_box_items (id, profile_id, kind, text, idea, theme, seconds, provider, used, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
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
      const segundos = item.segundos || segundosDoTexto(item.text, item.idea);
      insert.run(
        id, profile.id, kind, item.text, item.idea || null,
        tema.trim() || null, segundos, r.provider, agora,
      );
      novos.push({
        id,
        profileId: profile.id,
        kind,
        text: item.text,
        idea: item.idea || undefined,
        theme: tema.trim() || undefined,
        seconds: segundos,
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
