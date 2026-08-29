import "server-only";
import { getDb } from "./db";
import { getAppTimeZone, getAiCredentials, type AiProvider } from "./settings";
import { partsInTimeZone, startOfDayInTimeZone } from "./timezone";
import { getBotConfigByProfile } from "./telegramDb";
import { enqueuePreviasJob, getActivePreviasJob } from "./previasGenerator";
import { enqueueVipJob, getActiveVipJob } from "./vipGenerator";
import { resolverLinkDoVip } from "./vipLink";

/**
 * GERAÇÃO AUTOMÁTICA da programação do Telegram.
 *
 * O operador tinha que abrir o painel e clicar em "Gerar dias" para o canal não
 * amanhecer vazio — e a única forma de saber se precisava era olhando. Com o
 * interruptor ligado, o agendador monta sozinho o dia SEGUINTE, uma vez por
 * dia, e o canal fica sempre um dia à frente.
 *
 * POR QUE UM DIA À FRENTE, E NÃO UMA SEMANA: gerar sete dias de uma vez
 * congela a escolha de mídia no acervo daquele instante. Foto enviada na
 * quarta não entra num cronograma montado na segunda. Um dia por vez faz cada
 * dia ser montado com a galeria de ontem à noite — que é o mais atualizado
 * possível sem programar em cima da hora.
 *
 * Só vale para o MÉTODO MK. Os outros modos (intervalo/horário fixo) geram
 * dentro da própria requisição, sem fila — chamar isso de dentro do tique de
 * um minuto prenderia o agendador inteiro no meio de dezenas de chamadas de
 * IA. A tela diz isso onde o interruptor mora, em vez de aceitar o clique e
 * não fazer nada.
 */

/**
 * Hora do dia (no fuso da operação) em que a geração roda.
 *
 * À NOITE de propósito: o dia seguinte é montado com o acervo mais fresco que
 * existe, e ainda sobra a noite inteira antes do primeiro post da manhã.
 * Gerar de madrugada cumpriria o mesmo horário mas escolheria as fotos de
 * ontem — que é justamente o que este recurso existe para evitar.
 */
const HORA_DA_GERACAO = 21;

/** Só o dia seguinte. Ver o cabeçalho: gerar mais congela a escolha de mídia. */
const DIAS_POR_RODADA = 1;

type LinhaAuto = {
  profile_id: string;
  vip_auto_generate: number;
  warmup_auto_generate: number;
  vip_auto_generate_at: number | null;
  warmup_auto_generate_at: number | null;
  vip_schedule_type: string | null;
  warmup_schedule_type: string | null;
};

/**
 * Já rodou hoje?
 *
 * Compara com o começo do dia NO FUSO DA OPERAÇÃO, não com "24h atrás": o
 * recurso é "uma vez por dia", e uma janela deslizante de 24h iria empurrando o
 * horário para frente a cada rodada até atravessar a madrugada.
 */
function jaRodouHoje(ultimaVez: number | null, agora: number, tz: string): boolean {
  if (!ultimaVez) return false;
  return ultimaVez >= startOfDayInTimeZone(agora, tz);
}

/**
 * Está na hora de rodar?
 *
 * Nunca rodou = roda AGORA, seja que horas for: é o primeiro tique depois de o
 * operador ligar o interruptor, e fazê-lo esperar até as 21h para ver se
 * funcionou é o tipo de silêncio que faz alguém desligar o recurso achando que
 * está quebrado.
 *
 * Depois disso, a partir da hora marcada. A comparação é `>=` e não `===` para
 * a rotina se recuperar sozinha: servidor fora do ar às 21h volta às 23h e
 * ainda gera o dia, em vez de pular.
 */
function estaNaHora(ultimaVez: number | null, agora: number, tz: string): boolean {
  if (!ultimaVez) return true;
  if (jaRodouHoje(ultimaVez, agora, tz)) return false;
  return partsInTimeZone(agora, tz).hour >= HORA_DA_GERACAO;
}

function temIaConectada(): boolean {
  return (["grok", "gemini", "openai"] as AiProvider[]).some((p) => getAiCredentials(p) !== null);
}

function marcarRodada(profileId: string, canal: "vip" | "warmup", quando: number): void {
  getDb()
    .prepare(
      `UPDATE telegram_autopost_settings SET ${canal}_auto_generate_at = ? WHERE profile_id = ?`,
    )
    .run(quando, profileId);
}

/**
 * Uma passada do agendador. Nunca lança: é uma tarefa do tique de um minuto,
 * como as outras, e um perfil com problema não pode derrubar os demais.
 *
 * Devolve quantos canais foram enfileirados — quem escreve a copy continua
 * sendo `runPreviasGeneration`/`runVipGeneration`, em lotes, no mesmo tique.
 */
export async function runTelegramAutoGeneration(): Promise<number> {
  const db = getDb();
  const agora = Date.now();
  const tz = getAppTimeZone();

  const linhas = db
    .prepare(
      `SELECT profile_id, vip_auto_generate, warmup_auto_generate,
              vip_auto_generate_at, warmup_auto_generate_at,
              vip_schedule_type, warmup_schedule_type
         FROM telegram_autopost_settings
        WHERE vip_auto_generate = 1 OR warmup_auto_generate = 1`,
    )
    .all() as LinhaAuto[];
  if (linhas.length === 0) return 0;

  // Sem IA nenhuma conectada a copy sairia vazia em todo post do dia. Melhor
  // não gerar e deixar o operador ver o canal parado — que é um problema
  // visível — do que encher o dia de post sem texto.
  if (!temIaConectada()) return 0;

  let enfileirados = 0;

  for (const linha of linhas) {
    for (const canal of ["vip", "warmup"] as const) {
      try {
        const ligado = canal === "vip" ? linha.vip_auto_generate : linha.warmup_auto_generate;
        if (!ligado) continue;

        const tipo = canal === "vip" ? linha.vip_schedule_type : linha.warmup_schedule_type;
        if (tipo !== "mk") continue; // ver o cabeçalho: só o Método MK tem fila

        const ultimaVez =
          canal === "vip" ? linha.vip_auto_generate_at : linha.warmup_auto_generate_at;
        if (!estaNaHora(ultimaVez, agora, tz)) continue;

        const bot = getBotConfigByProfile(linha.profile_id);
        if (!bot?.botToken) continue;

        // Uma geração por vez por canal — a mesma trava do botão da tela. Duas
        // rodando juntas dobrariam os posts do dia, porque cada uma monta o
        // plano sem enxergar o que a outra vai agendar. NÃO marca a rodada:
        // assim o próximo tique tenta de novo, quando a fila estiver livre.
        const emAndamento =
          canal === "vip" ? getActiveVipJob(linha.profile_id) : getActivePreviasJob(linha.profile_id);
        if (emAndamento) continue;

        if (canal === "warmup") {
          // Um terço do dia das Prévias chama pro VIP e o envio anexa o link.
          // Sem link, esses posts sairiam convidando para lugar nenhum.
          const vip = await resolverLinkDoVip(linha.profile_id);
          if (!vip.link) {
            console.log(
              `[hotdash] geração automática das Prévias de ${linha.profile_id} adiada: ${vip.problem || "sem link do VIP"}`,
            );
            continue;
          }
          const job = enqueuePreviasJob(linha.profile_id, DIAS_POR_RODADA);
          // `total === 0` = todos os horários do dia já estavam ocupados. É
          // sucesso, não falha: a programação já está montada, e marcar a
          // rodada evita tentar de novo a cada minuto até a meia-noite.
          marcarRodada(linha.profile_id, canal, agora);
          if (job.total > 0) enfileirados++;
        } else {
          // Sem convite pro particular: é o padrão do botão da tela também (o
          // contato virou produto à parte e só entra quando pedido na hora).
          // Uma automação não tem como fazer essa escolha por quem opera.
          const job = enqueueVipJob({
            profileId: linha.profile_id,
            days: DIAS_POR_RODADA,
            contato: null,
            ctaLink: "",
          });
          marcarRodada(linha.profile_id, canal, agora);
          if (job.total > 0) enfileirados++;
        }
      } catch (err) {
        console.error(
          `[hotdash] erro na geração automática (${canal}) do perfil ${linha.profile_id}:`,
          err,
        );
      }
    }
  }

  return enfileirados;
}
