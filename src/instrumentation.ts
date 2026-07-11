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
}
