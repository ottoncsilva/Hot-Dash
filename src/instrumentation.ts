/**
 * Executado no início do processo do servidor (Next.js instrumentation).
 * Captura erros que normalmente iriam para o stderr (e podem não aparecer
 * nos logs do EasyPanel) e os joga no stdout, para diagnóstico. Também evita
 * que um erro capturável derrube o processo em loop.
 *
 * Além disso, hospeda o AGENDADOR EM SEGUNDO PLANO: um tick de 1 minuto que
 * roda dentro do próprio processo do servidor (sem depender de cron externo).
 * É ele que faz as postagens automáticas do Telegram saírem sozinhas, além
 * dos funis de remarketing/pós-venda, da expiração de assinaturas VIP e dos
 * lembretes push.
 */
export async function register() {
  process.on("uncaughtException", (err) => {
    console.log("[hotdash] uncaughtException:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.log("[hotdash] unhandledRejection:", reason);
  });
  console.log(
    `[hotdash] servidor iniciado · node ${process.version} · pid ${process.pid}`,
  );

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Importamos dinamicamente para evitar carregar módulos de servidor no build global.
    const { processReminders } = await import("@/lib/cronTasks");
    // O chip do Telegram vive NESTE processo: religa as sessões que já
    // estavam conectadas, senão todo deploy deixaria os leads no vácuo.
    try {
      const { religarChips } = await import("@/lib/telegramChip");
      await religarChips();
    } catch (err) {
      console.error("[hotdash] Erro religando os chips do Telegram:", err);
    }
    // Amarra o código de rastreio nas vendas antigas (uma vez só, marcada em
    // `settings`) — inclusive relendo os relatórios do Canal de Vendas que já
    // estavam guardados. Ver `lib/rastreio.ts`. Nunca lança.
    const { migrarCodigosDeRastreio } = await import("@/lib/rastreio");
    await migrarCodigosDeRastreio();
    const {
      runTelegramAutopost,
      runTelegramFunnels,
      runTelegramMailings,
      runTelegramEviction,
      runTelegramApprovalSequences,
    } = await import("@/lib/telegramCron");
    // Monitor dos grupos: consulta a API do Telegram e por isso funciona com a
    // operação do bot desligada, quando nenhum update chega pelo webhook.
    const { runTelegramGroupMonitor } = await import("@/lib/telegramMonitor");
    // Vigia do webhook: sem ele, um registro perdido derruba o bot de vendas em
    // silêncio — nada de /start, nada de aprovar entrada nas Prévias.
    const { runTelegramWebhookWatch } = await import("@/lib/telegramWebhookWatch");
    // Faxina da memória do LTV: guarda 40 dias por lead e apaga o resto.
    const { runLtvRetencao } = await import("@/lib/ltvRetencao");
    // Retoma quem sumiu no meio do papo do LTV (só nas contas com isso
    // ligado — ver SegurancaBlock).
    const { runLtvReengajamento } = await import("@/lib/ltvAgent");
    // Cliques/visualizações do SLT (link na bio) — próprio arquivo já
    // segura o intervalo de 15min recomendado pela API e é um no-op sem
    // chave configurada, então pode entrar no tick de sempre sem custo.
    const { syncSltEvents, syncSltCatalogue } = await import("@/lib/sltSync");
    // Geração do Método MK (Prévias e VIP), em lotes: a rota só enfileira (a
    // copy de um dia inteiro não cabe no maxDuration de uma requisição). Os dois
    // dividem UMA fila e um lote por tick — ver generationJobs.ts.
    const { runPreviasGeneration } = await import("@/lib/previasGenerator");
    const { runVipGeneration } = await import("@/lib/vipGenerator");
    // Geração automática da programação do dia seguinte (interruptor por
    // canal na tela de Automação). Só ENFILEIRA; quem escreve a copy são os
    // dois lotes acima, no mesmo tique.
    const { runTelegramAutoGeneration } = await import("@/lib/telegramAutoGeneration");

    // Trava anti-sobreposição: se um ciclo demorar mais que o intervalo (muitas
    // mídias, IA/Telegram lentos), o próximo tick é ignorado até o atual terminar.
    let running = false;

    async function tick() {
      if (running) return;
      running = true;
      try {
        // Cada tarefa é isolada: uma falha não impede as demais de rodarem.
        try {
          await processReminders();
        } catch (err) {
          console.error("[hotdash] Erro no cron (processReminders):", err);
        }
        try {
          const posted = await runTelegramAutopost();
          if (posted > 0) console.log(`[hotdash] autopost Telegram: ${posted} post(s) enviados.`);
        } catch (err) {
          console.error("[hotdash] Erro no cron (autopost Telegram):", err);
        }
        try {
          await runTelegramFunnels();
        } catch (err) {
          console.error("[hotdash] Erro no cron (funis Telegram):", err);
        }
        try {
          const { sent } = await runTelegramMailings();
          if (sent > 0) console.log(`[hotdash] mailing Telegram: ${sent} mensagem(ns) enviadas.`);
        } catch (err) {
          console.error("[hotdash] Erro no cron (mailing Telegram):", err);
        }
        try {
          await runTelegramEviction();
        } catch (err) {
          console.error("[hotdash] Erro no cron (expiração Telegram):", err);
        }
        try {
          const n = await runTelegramApprovalSequences();
          if (n > 0) console.log(`[hotdash] boas-vindas pós-aprovação: ${n} mensagem(ns).`);
        } catch (err) {
          console.error("[hotdash] Erro no cron (sequência de aprovação):", err);
        }
        try {
          await runTelegramGroupMonitor();
        } catch (err) {
          console.error("[hotdash] Erro no cron (monitor de grupos):", err);
        }
        try {
          await runTelegramWebhookWatch();
        } catch (err) {
          console.error("[hotdash] Erro no cron (vigia do webhook):", err);
        }
        try {
          const apagadas = runLtvRetencao();
          if (apagadas > 0) {
            console.log(`[hotdash] memória do LTV: ${apagadas} mensagem(ns) antiga(s) apagada(s).`);
          }
        } catch (err) {
          console.error("[hotdash] Erro no cron (memória do LTV):", err);
        }
        try {
          const retomados = await runLtvReengajamento();
          if (retomados > 0) console.log(`[hotdash] LTV: ${retomados} lead(s) retomado(s) após silêncio.`);
        } catch (err) {
          console.error("[hotdash] Erro no cron (retomada do LTV):", err);
        }
        try {
          const r = await syncSltEvents();
          if (r.synced > 0) console.log(`[hotdash] SLT: ${r.synced} evento(s) novo(s) sincronizado(s).`);
          if (!r.ok) console.error(`[hotdash] Erro no cron (sync SLT): ${r.error}`);
        } catch (err) {
          console.error("[hotdash] Erro no cron (sync SLT):", err);
        }
        try {
          // Catálogo (páginas/links) com intervalo PRÓPRIO, bem mais longo —
          // ele só muda quando o operador edita no painel da SLT. É o que
          // deixa a tela de Links ler do banco em vez de chamar a API.
          await syncSltCatalogue();
        } catch (err) {
          console.error("[hotdash] Erro no cron (catálogo SLT):", err);
        }
      } finally {
        running = false;
      }
    }

    /**
     * A GERAÇÃO tem ciclo próprio, separado do de cima.
     *
     * Um lote são 8 chamadas de IA com imagem, em sequência — passa de 60s com
     * facilidade. Enquanto elas rodavam dentro do ciclo principal, a trava
     * anti-sobreposição pulava o tick seguinte INTEIRO, e o autopost ia junto:
     * escrever a programação de amanhã atrasava a postagem de agora.
     *
     * Cada laço tem a sua própria trava, então um lote longo só adia o lote
     * seguinte. Os dois grupos continuam dividindo UMA fila (quem não é o job
     * mais antigo devolve 0 na hora), para não rodar dois lotes ao mesmo tempo.
     */
    let gerando = false;

    /**
     * Quanto tempo um ciclo de geração pode ficar puxando lotes seguidos.
     *
     * O tick de 1 minuto ERA o teto real do tempo de geração: um lote por
     * minuto significa que 210 posts levavam ~27 minutos, com o servidor
     * ocioso quase o tempo todo. Agora, enquanto o job tiver trabalho, o ciclo
     * emenda um lote no outro sem esperar o próximo minuto.
     *
     * O limite existe para o ciclo não virar um laço infinito segurando o
     * processo: ao estourar, ele devolve o controle e o tick seguinte retoma
     * de onde parou (o progresso está gravado no job a cada lote).
     */
    const JANELA_GERACAO_MS = 5 * 60 * 1000;

    async function tickGeracao() {
      if (gerando) return;
      gerando = true;
      const ate = Date.now() + JANELA_GERACAO_MS;
      try {
        // ANTES dos lotes, de propósito: o que for enfileirado agora já começa
        // a ser escrito nesta mesma passada, em vez de esperar o próximo tique.
        try {
          const canais = await runTelegramAutoGeneration();
          if (canais > 0) {
            console.log(`[hotdash] geração automática: ${canais} canal(is) com o dia seguinte enfileirado.`);
          }
        } catch (err) {
          console.error("[hotdash] Erro no cron (geração automática):", err);
        }

        // `runPreviasGeneration`/`runVipGeneration` processam UM lote e
        // devolvem quantos posts criaram; 0 = não há mais trabalho agora.
        // Repetir enquanto houver é o que tira a espera de 60s entre lotes.
        for (;;) {
          let fezAlgo = false;
          try {
            const gerados = await runPreviasGeneration();
            if (gerados > 0) {
              console.log(`[hotdash] Método MK (Prévias): ${gerados} post(s) gerados.`);
              fezAlgo = true;
            }
          } catch (err) {
            console.error("[hotdash] Erro no cron (geração das Prévias):", err);
          }
          try {
            const gerados = await runVipGeneration();
            if (gerados > 0) {
              console.log(`[hotdash] Método MK (VIP): ${gerados} post(s) gerados.`);
              fezAlgo = true;
            }
          } catch (err) {
            console.error("[hotdash] Erro no cron (geração do VIP):", err);
          }
          if (!fezAlgo || Date.now() >= ate) break;
        }
      } finally {
        gerando = false;
      }
    }

    // Roda a cada 1 minuto (garante pontualidade das postagens agendadas).
    setInterval(() => {
      void tick();
    }, 60 * 1000);

    // Mesmo intervalo, laço independente: a geração nunca segura o autopost.
    setInterval(() => {
      void tickGeracao();
    }, 60 * 1000);
  }
}
