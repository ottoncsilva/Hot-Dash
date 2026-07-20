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
    const {
      runTelegramAutopost,
      runTelegramFunnels,
      runTelegramEviction,
    } = await import("@/lib/telegramCron");

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
          await runTelegramEviction();
        } catch (err) {
          console.error("[hotdash] Erro no cron (expiração Telegram):", err);
        }
      } finally {
        running = false;
      }
    }

    // Roda a cada 1 minuto (garante pontualidade das postagens agendadas).
    setInterval(() => {
      void tick();
    }, 60 * 1000);
  }
}
