/**
 * Executado no início do processo do servidor (Next.js instrumentation).
 * Captura erros que normalmente iriam para o stderr (e podem não aparecer
 * nos logs do EasyPanel) e os joga no stdout, para diagnóstico. Também evita
 * que um erro capturável derrube o processo em loop.
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
    
    // Roda a cada 1 minuto (para garantir pontualidade, ou a cada 5)
    setInterval(async () => {
      try {
        await processReminders();
      } catch (err) {
        console.error("[hotdash] Erro no background cron (processReminders):", err);
      }
    }, 60 * 1000);
  }
}
