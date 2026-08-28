import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { upsertTelegramUser } from "./telegramUsers";

/**
 * VÍNCULO de pagamento a lead/bot pra vendas que NÃO passam pelo checkout do
 * Hot-Dash (ex.: o Bobz, que opera alguns bots por fora). O pagamento em si
 * (SyncPay/Stripe) chega pelo webhook de sempre, mas sem saber de qual
 * modelo — nenhum dado nosso liga uma cobrança "fria" a um bot específico.
 *
 * A peça que falta vem de outro lugar: o próprio Bobz (e qualquer sistema
 * que siga o mesmo padrão de mercado) posta no GRUPO DE VENDAS um resumo de
 * cada venda — mesmíssimo formato que o Hot-Dash usa pros bots que ele
 * controla (ver `buildSalesReportMessage` em `payments/deliverPayment.ts`):
 * ID Bot (prefixo numérico do token), ID Cliente (o Telegram do lead) e ID
 * Transação Gateway (a MESMA referência que o webhook de pagamento traz).
 * Com a Recepção de informações lendo esse grupo (`idVendas` do bot), dá
 * pra casar os dois lados por essa referência — sem precisar de nome,
 * e-mail ou CPF, que o Telegram nem tem.
 *
 * A ordem de chegada não é garantida (às vezes o pagamento chega primeiro,
 * às vezes o relatório): guarda os dois lados batendo por
 * `(provider, provider_ref)` e corrige quem chegou primeiro assim que o
 * segundo aparece.
 */

export type RelatorioExternoParsed = {
  idBot?: string;
  telegramUserId?: number;
  username?: string;
  nomePerfil?: string;
  plano?: string;
  providerRef?: string;
  /** Normalizado (minúsculo) — "SyncPay" no texto vira "syncpay" aqui, pra
   *  bater com o `provider` que os webhooks já usam. */
  provider?: string;
};

/** Tira o(s) emoji(s)/símbolos do início da linha, até a primeira letra —
 *  robusto a qualquer emoji específico (não depende de listar cada um). */
function semEmojiNoComeco(linha: string): string {
  return linha.replace(/^[^\p{L}]+/u, "").trim();
}

/**
 * "🆔 ID Cliente: 8346804807" → { "ID Cliente": "8346804807" }. Só reconhece
 * o formato "rótulo: valor" por linha — qualquer mensagem que não seja um
 * relatório de venda (e não tenha "ID Transação Gateway") devolve `null` sem
 * gastar tempo processando o resto.
 */
export function parseSalesReportMessage(text: string): RelatorioExternoParsed | null {
  if (!text || !/ID Transa[cç][aã]o Gateway/i.test(text)) return null;

  const campos: Record<string, string> = {};
  for (const linhaCrua of text.split("\n")) {
    const linha = semEmojiNoComeco(linhaCrua);
    const m = linha.match(/^([\p{L}][\p{L}\s]*?):\s*(.+)$/u);
    if (m) campos[m[1].trim()] = m[2].trim();
  }

  const idClienteNum = Number(campos["ID Cliente"]);
  const providerRef = campos["ID Transação Gateway"];

  return {
    idBot: campos["ID Bot"] || undefined,
    telegramUserId: Number.isFinite(idClienteNum) && idClienteNum > 0 ? idClienteNum : undefined,
    username: campos["Username"]?.replace(/^@/, "") || undefined,
    nomePerfil: campos["Nome de Perfil"] && campos["Nome de Perfil"] !== "-" ? campos["Nome de Perfil"] : undefined,
    plano: campos["Plano"] || undefined,
    providerRef: providerRef && providerRef !== "-" ? providerRef : undefined,
    provider: campos["Plataforma Pagamento"]?.trim().toLowerCase() || undefined,
  };
}

/**
 * Processa um relatório de venda visto no Grupo de Vendas (ver
 * `registrarChegadaTelegram`, que chama isto quando a mensagem chega no
 * chat marcado como `idVendas` do bot). Nunca lança — é tráfego de grupo
 * real, um relatório mal formado não pode derrubar o resto da recepção.
 */
export function registrarRelatorioExterno(text: string): void {
  try {
    const parsed = parseSalesReportMessage(text);
    if (!parsed?.providerRef || !parsed.provider) return; // sem a chave de junção, não há o que fazer

    const db = getDb();

    // Resolve bot/modelo pelo prefixo numérico do TOKEN — é o mesmo id que
    // qualquer relatório deste formato usa como "ID Bot" (ver
    // `buildSalesReportMessage`: `botToken.split(":")[0]`).
    let botId: string | undefined;
    let profileId: string | undefined;
    if (parsed.idBot) {
      const row = db
        .prepare("SELECT id, profile_id FROM telegram_bots WHERE bot_token LIKE ? || ':%'")
        .get(parsed.idBot) as { id: string; profile_id: string } | undefined;
      if (row) {
        botId = row.id;
        profileId = row.profile_id;
      }
    }

    db.prepare(
      `INSERT INTO external_sale_reports
         (id, provider, provider_ref, bot_id, profile_id, telegram_user_id, telegram_username, plan_name, raw_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_ref) DO UPDATE SET
         bot_id = COALESCE(excluded.bot_id, external_sale_reports.bot_id),
         profile_id = COALESCE(excluded.profile_id, external_sale_reports.profile_id),
         telegram_user_id = COALESCE(excluded.telegram_user_id, external_sale_reports.telegram_user_id),
         telegram_username = COALESCE(excluded.telegram_username, external_sale_reports.telegram_username),
         plan_name = COALESCE(excluded.plan_name, external_sale_reports.plan_name)`,
    ).run(
      randomUUID(),
      parsed.provider,
      parsed.providerRef,
      botId || null,
      profileId || null,
      parsed.telegramUserId || null,
      parsed.username || null,
      parsed.plano || null,
      text.slice(0, 2000),
      Date.now(),
    );

    // BACKFILL: se o pagamento já tinha chegado (webhook antes do
    // relatório), a transação já existe mas nasceu "Sem modelo" — corrige
    // agora que sabemos de quem é. Só quando ainda está NULL: nunca
    // sobrescreve uma atribuição que já existia (a nossa própria, feita na
    // hora certa, ou uma correção manual que o operador já fez na tela).
    if (profileId) {
      db.prepare(
        `UPDATE transactions SET profile_id = ?, bot_id = COALESCE(bot_id, ?)
          WHERE provider = ? AND provider_ref = ? AND profile_id IS NULL`,
      ).run(profileId, botId || null, parsed.provider, parsed.providerRef);
    }

    // Tela de USUÁRIOS: mesmo sem o /start deste lead ter sido capturado
    // pela recepção (modo "poll" é melhor-esforço, e quem comprou pode ter
    // dado /start antes da recepção existir), o relatório de venda já basta
    // pra ele aparecer lá — fonte "compra", pra distinguir de quem a
    // recepção viu de verdade dar /start. Upsert: se já existir (o /start
    // FOI capturado), só complementa — nunca apaga o que já tinha.
    if (botId && profileId && parsed.telegramUserId) {
      upsertTelegramUser({
        botId,
        profileId,
        telegramUserId: parsed.telegramUserId,
        username: parsed.username,
        firstName: parsed.nomePerfil,
        source: "compra",
      });
    }
  } catch (err) {
    console.error("[hotdash] erro registrando relatório externo de venda:", err);
  }
}

/**
 * Consultada pelos webhooks de pagamento (SyncPay/Stripe) na hora de gravar
 * uma venda "fria" (sem transação pendente pré-existente) — se o relatório
 * do Grupo de Vendas já chegou primeiro, a venda nasce JÁ atribuída, em vez
 * de cair em "Sem modelo" pra corrigir na mão depois.
 */
/**
 * Separa um texto colado (várias mensagens do Grupo de Vendas coladas
 * juntas — do jeito que o Telegram entrega quando você seleciona várias
 * mensagens no celular e copia, ou de um histórico exportado) em blocos, um
 * por venda. O separador é a linha de atribuição que o próprio Telegram
 * insere entre mensagens copiadas: "Nome do canal, [DD de mês de AAAA às
 * HH:MM]". Uma mensagem colada avulsa (sem esse cabeçalho) vira um bloco só.
 */
export function splitSalesReportBlob(blob: string): string[] {
  const linhas = blob.split("\n");
  const cabecalho = /^.+,\s*\[\d{1,2} de \S+ de \d{4} às \d{2}:\d{2}\]\s*$/;
  const blocos: string[] = [];
  let atual: string[] = [];
  for (const linha of linhas) {
    if (cabecalho.test(linha.trim())) {
      if (atual.length) blocos.push(atual.join("\n").trim());
      atual = [];
    } else {
      atual.push(linha);
    }
  }
  if (atual.length) blocos.push(atual.join("\n").trim());
  return blocos.filter(Boolean);
}

export type ResultadoImportacao = {
  total: number;
  reconhecidos: number;
  vinculadosABot: number;
  transacoesCorrigidas: number;
};

/**
 * IMPORTAÇÃO EM LOTE — histórico colado (o Telegram não deixa um bot ler
 * mensagens antigas, então isso cobre o que já aconteceu ANTES da recepção
 * existir; ver a explicação completa dada ao operador). Reaproveita
 * `registrarRelatorioExterno` bloco a bloco — mesma lógica, mesmas travas
 * (nunca sobrescreve uma venda já atribuída), só que de uma vez só.
 */
export function importarRelatoriosExternos(blob: string): ResultadoImportacao {
  const blocos = splitSalesReportBlob(blob);
  let reconhecidos = 0;
  let vinculadosABot = 0;
  let transacoesCorrigidas = 0;
  const db = getDb();

  for (const bloco of blocos) {
    const parsed = parseSalesReportMessage(bloco);
    if (!parsed?.providerRef || !parsed.provider) continue;
    reconhecidos++;

    // Conta ANTES de registrar se essa venda específica ainda estava sem
    // modelo — pra distinguir "corrigiu uma venda" de "só confirmou o que
    // já estava certo" no resumo mostrado ao operador.
    const antes = db
      .prepare("SELECT 1 FROM transactions WHERE provider = ? AND provider_ref = ? AND profile_id IS NULL")
      .get(parsed.provider, parsed.providerRef);

    registrarRelatorioExterno(bloco);

    const vinculo = buscarRelatorioExterno(parsed.provider, parsed.providerRef);
    if (vinculo?.profileId) vinculadosABot++;
    if (antes && vinculo?.profileId) transacoesCorrigidas++;
  }

  return { total: blocos.length, reconhecidos, vinculadosABot, transacoesCorrigidas };
}

export function buscarRelatorioExterno(
  provider: string,
  providerRef: string,
): { botId?: string; profileId?: string; telegramUserId?: number; telegramUsername?: string; planName?: string } | null {
  const row = getDb()
    .prepare(
      `SELECT bot_id, profile_id, telegram_user_id, telegram_username, plan_name
         FROM external_sale_reports WHERE provider = ? AND provider_ref = ?`,
    )
    .get(provider.toLowerCase(), providerRef) as
    | {
        bot_id: string | null;
        profile_id: string | null;
        telegram_user_id: number | null;
        telegram_username: string | null;
        plan_name: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    botId: row.bot_id || undefined,
    profileId: row.profile_id || undefined,
    telegramUserId: row.telegram_user_id || undefined,
    telegramUsername: row.telegram_username || undefined,
    planName: row.plan_name || undefined,
  };
}
