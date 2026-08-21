import "server-only";
import { getAiCredentials } from "./settings";
import { mensagemDeModeracao } from "./aiMediaErros";
import { modeloMotion } from "./aiMediaOptions";

/**
 * ENCANAMENTO DA MAGNIFIC — o que é igual em toda chamada dela.
 *
 * Os três módulos que falam com a Magnific (motion control, imagem e vídeo)
 * repetem exatamente a mesma dança: POST com `x-magnific-api-key`, resposta
 * embrulhada num `data`, um `task_id` de volta, e consulta em
 * `GET {caminho}/{task-id}` até o `status` sair de `IN_PROGRESS`. O que muda
 * de um para o outro é só o caminho e o corpo do pedido.
 *
 * Isto aqui nasceu dentro do motionGen.ts, quando a Magnific atendia um
 * recurso só. Com três, manter três cópias do mapa de erros e do laço de
 * consulta seria pedir para elas divergirem.
 */

const BASE = "https://api.magnific.com/v1/ai";

/**
 * Traduz o erro da Magnific para algo que o operador entende sem abrir o
 * console. Cada código é uma causa concreta, não "falha genérica".
 */
export function mensagemDoErroMagnific(status: number, apiMsg: string): string {
  const moderacao = mensagemDeModeracao(apiMsg);
  if (moderacao) return moderacao;
  const base = apiMsg ? ` (${apiMsg})` : "";
  switch (status) {
    case 400:
      return `Pedido recusado pela Magnific — parâmetro inválido, ou ela não conseguiu ler a imagem enviada${base}.`;
    case 401:
    case 403:
      return "Chave da Magnific recusada. Confira em Configurações → Conexão com IA.";
    case 404:
      return "Modelo ou tarefa não encontrada na Magnific.";
    case 402:
      return "Créditos insuficientes na conta da Magnific.";
    case 429:
      return "Muitos pedidos em sequência — aguarde um instante e tente de novo.";
    case 500:
    case 503:
      return "A Magnific falhou ao gerar. Tente de novo.";
    default:
      return `Falha na Magnific (${status})${base}.`;
  }
}

/**
 * A chave. O slot do `kling` compartilha a do `magnific` — é assim que as
 * Configurações guardam desde antes destes módulos existirem —, então
 * qualquer um dos dois serve para descobri-la.
 */
export function chaveMagnificOuFalha(): string {
  const creds = getAiCredentials("magnific") || getAiCredentials("kling");
  if (!creds) {
    throw new Error(
      "Magnific não está conectada. Ative e cole a chave em Configurações → Conexão com IA.",
    );
  }
  return creds.apiKey;
}

/** Desembrulha o `data` que a Magnific põe em volta de toda resposta. */
function conteudo(data: Record<string, unknown>): Record<string, unknown> {
  return (data.data as Record<string, unknown>) || data;
}

function mensagemDaResposta(data: Record<string, unknown>): string {
  const err = data.error as Record<string, unknown> | undefined;
  if (typeof err?.message === "string") return err.message;
  if (typeof data.message === "string") return data.message;
  return "";
}

/**
 * Submete uma tarefa e devolve o id CARIMBADO COM O CAMINHO.
 *
 * O carimbo existe porque a consulta de status precisa do caminho na URL, e a
 * rota de acompanhamento (/api/ai/video-gen/[jobId]) só recebe um
 * identificador. Guardar `caminho/taskId` resolve para motion, Kling, Veo e
 * Seedance sem caso especial nenhum.
 */
export async function submeterTarefaMagnific(
  caminho: string,
  body: Record<string, unknown>,
): Promise<string> {
  const apiKey = chaveMagnificOuFalha();
  const res = await fetch(`${BASE}/${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-magnific-api-key": apiKey },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(mensagemDoErroMagnific(res.status, mensagemDaResposta(data)));

  const d = conteudo(data);
  const taskId = typeof d.task_id === "string" ? d.task_id : "";
  if (!taskId) throw new Error("A Magnific não devolveu a tarefa.");
  return `${caminho}/${taskId}`;
}

/**
 * Separa o carimbo `caminho/taskId`. O id da tarefa é sempre o ÚLTIMO
 * segmento, porque o caminho tem barras dentro dele
 * (`image-to-video/kling-v2-6-pro`).
 */
export function partesDaTarefa(jobId: string): { caminho: string; taskId: string } {
  const i = jobId.lastIndexOf("/");
  if (i < 0) return { caminho: "", taskId: jobId };
  return { caminho: jobId.slice(0, i), taskId: jobId.slice(i + 1) };
}

/**
 * COMPATIBILIDADE COM OS JOBS ANTIGOS DO MOTION CONTROL.
 *
 * Enquanto a Magnific atendeu só o motion control, o carimbo era
 * `modeloId/taskId` e o slug saía do catálogo na hora de consultar. Agora é o
 * caminho inteiro (`video/kling-v2-6-motion-control-pro/taskId`), que serve
 * também para imagem, Kling, Veo e Seedance — e é o que permite uma consulta
 * só atender todos.
 *
 * Um job submetido antes desta mudança e consultado depois cairia num caminho
 * que não existe. Aqui o formato velho é reconhecido pela ausência de barra no
 * "caminho" e traduzido.
 */
export function normalizarJobMagnific(jobId: string): string {
  const { caminho, taskId } = partesDaTarefa(jobId);
  if (caminho.includes("/")) return jobId; // já é o formato novo
  if (!caminho) return jobId;
  return `video/${modeloMotion(caminho).slug}/${taskId}`;
}

export type TarefaMagnific = {
  status: string;
  /** URLs do que foi gerado — imagem ou vídeo, conforme o endpoint. */
  gerados: string[];
  erro?: string;
};

export async function consultarTarefaMagnific(jobId: string): Promise<TarefaMagnific> {
  const apiKey = chaveMagnificOuFalha();
  const { caminho, taskId } = partesDaTarefa(normalizarJobMagnific(jobId));

  const res = await fetch(`${BASE}/${caminho}/${encodeURIComponent(taskId)}`, {
    headers: { "x-magnific-api-key": apiKey },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(mensagemDoErroMagnific(res.status, mensagemDaResposta(data)));

  const d = conteudo(data);
  const bruto = d.generated;
  const gerados = Array.isArray(bruto)
    ? bruto.filter((x): x is string => typeof x === "string")
    : typeof bruto === "string"
      ? [bruto]
      : [];

  return {
    status: String(d.status || "").toUpperCase(),
    gerados,
    erro: typeof d.error === "string" ? d.error : undefined,
  };
}

/** Baixa o arquivo pronto. A URL da Magnific é pública e temporária; buscar
 *  aqui evita que o navegador precise dela. */
export async function baixarArquivoMagnific(
  url: string,
  contentTypePadrao: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(mensagemDoErroMagnific(res.status, ""));
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || contentTypePadrao,
  };
}

/**
 * Espera a tarefa terminar, consultando de tempos em tempos.
 *
 * Só a GERAÇÃO DE IMAGEM usa isto: ali a rota do painel é síncrona (devolve o
 * base64 na resposta), então o laço tem que acontecer no servidor. O vídeo NÃO
 * passa por aqui — lá quem repete a consulta é o cliente, que já tem esse laço
 * pronto e sobrevive a fechar a aba.
 */
export async function esperarTarefaMagnific(
  jobId: string,
  opcoes: { tetoMs: number; intervaloMs?: number },
): Promise<TarefaMagnific> {
  const intervalo = opcoes.intervaloMs ?? 2000;
  const limite = Date.now() + opcoes.tetoMs;

  for (;;) {
    const t = await consultarTarefaMagnific(jobId);
    if (t.status === "COMPLETED") return t;
    if (t.status === "FAILED" || t.status === "ERROR") {
      throw new Error(t.erro || "A Magnific não conseguiu gerar.");
    }
    if (Date.now() + intervalo > limite) {
      // A tarefa continua viva do lado deles — e já foi cobrada. Dizer isso é
      // melhor que um "falhou" que faria o operador pagar de novo.
      throw new Error(
        "A Magnific ainda está gerando e passou do tempo que esta tela espera. " +
          "A geração continua lá; veja no painel da Magnific.",
      );
    }
    await new Promise((r) => setTimeout(r, intervalo));
  }
}
