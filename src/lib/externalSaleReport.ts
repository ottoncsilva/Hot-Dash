import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { upsertTelegramUser } from "./telegramUsers";
import { getVendasExternasSettings } from "./settings";

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
 * Casando os dois lados por essa referência dá pra atribuir a venda — sem
 * precisar de nome, e-mail ou CPF, que o Telegram nem tem.
 *
 * COMO O RELATÓRIO CHEGA: por um bot que o Hot-Dash controla e que também
 * está no Grupo de Vendas (`idVendas`) — é ele que "ouve" o grupo. O bot
 * REPORTADO na mensagem ("ID Bot") é outro: o que o sistema de origem opera.
 * Nada aqui intercepta o bot de ninguém; só se lê uma mensagem de grupo que
 * já chegaria de qualquer jeito.
 *
 * SÓ VALE PRA BOT INATIVO (ver a trava em `registrarRelatorioExterno`).
 * Quando o bot reportado é um bot que o PRÓPRIO Hot-Dash opera, a venda já
 * entrou pelo checkout dele, com modelo/bot/lead certos desde o começo — e o
 * relatório no grupo foi postado pelo próprio Hot-Dash
 * (`buildSalesReportMessage`). Processá-lo de novo seria reprocessar a
 * própria saída: trabalho duplicado, sem nada a acrescentar.
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

/**
 * Primeira palavra de um valor. Os campos que este parser usa para DECIDIR
 * (plataforma de pagamento, id da transação no gateway, id do bot) são
 * identificadores sem espaço. Ficar só com a primeira palavra descarta
 * qualquer coisa que o Telegram tenha grudado no fim da linha ao copiar
 * várias mensagens — ver `ATRIBUICAO_DO_TELEGRAM`.
 */
function primeiroToken(v: string | undefined): string | undefined {
  const t = (v || "").trim().split(/\s+/)[0];
  return t || undefined;
}

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
    idBot: primeiroToken(campos["ID Bot"]),
    telegramUserId: Number.isFinite(idClienteNum) && idClienteNum > 0 ? idClienteNum : undefined,
    username: campos["Username"]?.replace(/^@/, "") || undefined,
    nomePerfil: campos["Nome de Perfil"] && campos["Nome de Perfil"] !== "-" ? campos["Nome de Perfil"] : undefined,
    plano: campos["Plano"] || undefined,
    providerRef: providerRef && providerRef !== "-" ? primeiroToken(providerRef) : undefined,
    provider: primeiroToken(campos["Plataforma Pagamento"])?.toLowerCase(),
  };
}

/**
 * Processa um relatório de venda visto no Grupo de Vendas (ver
 * `registrarChegadaTelegram`, que chama isto quando a mensagem chega no
 * chat marcado como `idVendas` do bot). Nunca lança — é tráfego de grupo
 * real, um relatório mal formado não pode derrubar o resto do processamento
 * do update.
 */
export function registrarRelatorioExterno(text: string): void {
  try {
    // Interruptor da tela (Configurações → Pagamentos). A trava fica AQUI, no
    // núcleo, e não em cada chamador: assim vale igual pro relatório que
    // chega ao vivo no grupo e pra importação em lote, sem dois
    // comportamentos pra explicar.
    if (!getVendasExternasSettings().vincularPeloGrupo) return;
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
        .prepare("SELECT id, profile_id, operation_active FROM telegram_bots WHERE bot_token LIKE ? || ':%'")
        .get(parsed.idBot) as { id: string; profile_id: string; operation_active: number } | undefined;
      if (row) {
        // BOT ATIVO = o Hot-Dash operou essa venda do começo ao fim (checkout
        // próprio, transação já atribuída, lead já cadastrado) e foi ELE quem
        // postou este relatório no grupo. Reprocessar aqui não acrescenta
        // nada e só refaz trabalho: upsert de usuário e uma consulta de
        // membro à API do Telegram por venda. Sai fora.
        if (row.operation_active) return;
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

    // Tela de USUÁRIOS: o /start deste lead nunca vai ser capturado (o bot é
    // operado por fora, e o Hot-Dash não intercepta nada dele), mas o
    // relatório de venda já basta pra ele aparecer lá — fonte "compra", pra
    // distinguir de quem foi visto dando /start de verdade. Upsert: se já
    // existir, só complementa — nunca apaga o que já tinha.
    if (botId && profileId && parsed.telegramUserId) {
      upsertTelegramUser({
        botId,
        profileId,
        telegramUserId: parsed.telegramUserId,
        username: parsed.username,
        firstName: parsed.nomePerfil,
        source: "compra",
      });
      // NÃO marca VIP aqui, de propósito. "VIP" na tela de Usuários é "está
      // no grupo AGORA" (ver ACTIVE_VIP em telegramUsers.ts), e comprar não
      // confirma isso. Consultar a API por venda também não escala: um
      // export de histórico são centenas de vendas de uma vez. Quem mantém o
      // VIP em dia é o monitor de grupos, que já lê a situação real. Aqui só
      // se contabiliza o que o relatório de fato diz.
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
 * Converte o HTML de um EXPORT do Telegram Desktop (Exportar histórico →
 * HTML, arquivo `messages.html`) no mesmo texto que sairia de um copiar e
 * colar. É o caminho para importar o histórico INTEIRO de uma vez: colar
 * centenas de mensagens à mão não é viável, e o export é o único jeito de
 * pegar tudo que já passou (a API do Telegram não deixa um bot ler mensagem
 * antiga de grupo).
 *
 * No export, o texto de cada mensagem vem numa linha só, com `<br>` no lugar
 * das quebras e os valores embrulhados em `<a>` (o Telegram transforma
 * número em link de telefone e id de cliente em menção). Basta virar as
 * quebras em linha de verdade, tirar as marcações e desfazer as entidades —
 * o resto do caminho é o mesmo do texto colado.
 */
export function extrairTextoDoHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    // <div>, </p> e afins também separam mensagens: sem isto, o fim de uma
    // mensagem colaria na abertura da seguinte numa linha só.
    .replace(/<\/(div|p|li|td|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // `&amp;` por último: antes das outras, viraria "&" e poderia recriar uma
    // entidade que não existia no original.
    .replace(/&amp;/gi, "&");
}

/**
 * Marca de abertura do relatório — a PRIMEIRA linha de toda venda, tanto no
 * formato do Bobz quanto no que o próprio Hot-Dash gera
 * (`buildSalesReportMessage`: "🎉 <b>Pagamento Aprovado!</b>").
 */
const ABERTURA_DO_RELATORIO = /pagamento\s+aprovado/i;

/**
 * Linha de atribuição que o Telegram insere ao copiar várias mensagens:
 * "Nome do canal, [29 de ago de 2026 às 02:12]". Exige HORA dentro dos
 * colchetes para não confundir com conteúdo do relatório que por acaso tenha
 * colchetes.
 *
 * Tira SÓ o ", [data]" — a parte inequívoca. O nome do canal fica, e de
 * propósito: dependendo do aplicativo o cabeçalho vem GRUDADO no fim da
 * linha anterior ("🏦 Plataforma Pagamento: SyncPay Vendas Otton, [29 de
 * ago...]"), e ali não existe separador que diga onde acaba o VALOR do campo
 * e começa o nome do canal. Tentar adivinhar comia o "SyncPay" junto.
 *
 * Quem resolve o resto é `primeiroToken` abaixo: os campos que importam
 * (plataforma, id da transação, id do bot) são identificadores de uma
 * palavra só, então o nome do canal que sobrou grudado é descartado na
 * leitura do campo, sem precisar adivinhar nada no texto.
 *
 * Era isso que quebrava a importação: o separador antigo descartava a linha
 * inteira e levava junto a "Plataforma Pagamento" da venda anterior. Sem
 * plataforma, o bloco era jogado fora — de quatro vendas coladas, só a
 * última (que não tem cabeçalho depois) era reconhecida.
 */
const ATRIBUICAO_DO_TELEGRAM = /,\s*\[[^\]\n]*\d{1,2}:\d{2}[^\]\n]*\]\s*$/;

/**
 * Separa um texto colado (várias mensagens do Grupo de Vendas coladas juntas)
 * em blocos, um por venda.
 *
 * O corte é feito pela PRIMEIRA LINHA DA PRÓPRIA VENDA ("Pagamento
 * Aprovado"), não pelo cabeçalho do Telegram. O cabeçalho muda de formato
 * conforme o aplicativo, o idioma e o jeito de copiar — às vezes nem vem — e
 * depender dele era frágil. A abertura do relatório é do sistema que gera a
 * mensagem, sempre igual.
 *
 * O cabeçalho do Telegram, quando existe, é limpo de cada linha antes do
 * corte (ver `ATRIBUICAO_DO_TELEGRAM`).
 */
export function splitSalesReportBlob(blob: string): string[] {
  // Arquivo de export do Telegram (HTML) entra aqui igual ao texto colado —
  // é só desmontar a marcação antes. Detectado pela presença de tag, não pela
  // extensão: o operador cola OU manda o arquivo, e nos dois casos chega
  // texto nesta função.
  const texto = /<br\s*\/?>|<div\b|<!doctype html/i.test(blob) ? extrairTextoDoHtml(blob) : blob;
  const linhas = texto.split("\n").map((l) => l.replace(ATRIBUICAO_DO_TELEGRAM, "").trimEnd());

  // Sem a marca de abertura (formato desconhecido, ou uma venda avulsa colada
  // sem o cabeçalho dela), devolve tudo como um bloco só — é o melhor palpite
  // possível e mantém o caso de "colei UMA mensagem" funcionando.
  if (!linhas.some((l) => ABERTURA_DO_RELATORIO.test(l))) {
    const unico = linhas.join("\n").trim();
    return unico ? [unico] : [];
  }

  const blocos: string[] = [];
  let atual: string[] | null = null;
  for (const linha of linhas) {
    if (ABERTURA_DO_RELATORIO.test(linha)) {
      if (atual) blocos.push(atual.join("\n").trim());
      atual = [linha];
    } else if (atual) {
      atual.push(linha);
    }
    // Antes da primeira abertura é lixo de cópia (cabeçalho solto, linha em
    // branco): descartado em vez de virar um bloco que nunca casaria.
  }
  if (atual) blocos.push(atual.join("\n").trim());
  return blocos.filter(Boolean);
}

export type ResultadoImportacao = {
  total: number;
  reconhecidos: number;
  vinculadosABot: number;
  transacoesCorrigidas: number;
  /** Relatórios de bots que o PRÓPRIO Hot-Dash opera — ignorados de
   *  propósito: essas vendas já entraram pelo checkout dele, atribuídas
   *  desde o começo (ver a trava em `registrarRelatorioExterno`). */
  ignoradosBotAtivo: number;
};

/**
 * IMPORTAÇÃO EM LOTE — histórico colado. O Telegram não deixa um bot ler
 * mensagens antigas de um grupo, então esta é a única forma de cobrir vendas
 * que aconteceram antes de o bot "ouvinte" estar no Grupo de Vendas.
 * Reaproveita `registrarRelatorioExterno` bloco a bloco — mesma lógica,
 * mesmas travas (nunca sobrescreve uma venda já atribuída; ignora relatório
 * de bot que o Hot-Dash opera), só que de uma vez só.
 */
export function importarRelatoriosExternos(blob: string): ResultadoImportacao {
  const blocos = splitSalesReportBlob(blob);
  let reconhecidos = 0;
  let vinculadosABot = 0;
  let transacoesCorrigidas = 0;
  let ignoradosBotAtivo = 0;
  const db = getDb();

  for (const bloco of blocos) {
    const parsed = parseSalesReportMessage(bloco);
    if (!parsed?.providerRef || !parsed.provider) continue;
    reconhecidos++;

    // Mesma trava de `registrarRelatorioExterno`, conferida aqui só pra
    // poder CONTAR e explicar no resumo por que esses blocos não viraram
    // vínculo (senão o operador vê "reconhecidos > vinculados" e acha que
    // falhou algo).
    if (parsed.idBot) {
      const dono = db
        .prepare("SELECT operation_active FROM telegram_bots WHERE bot_token LIKE ? || ':%'")
        .get(parsed.idBot) as { operation_active: number } | undefined;
      if (dono?.operation_active) {
        ignoradosBotAtivo++;
        continue;
      }
    }

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

  return { total: blocos.length, reconhecidos, vinculadosABot, transacoesCorrigidas, ignoradosBotAtivo };
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
