import "server-only";
import { renovarToken } from "./api";
import { getAccountToken, listAccounts, setAccountStatus, setAccountToken, limparEventosAntigos } from "./db";

/**
 * RENOVAÇÃO DOS TOKENS, no tique de fundo.
 *
 * O token do Instagram dura 60 dias e, passado esse prazo sem renovar, MORRE —
 * não dá para ressuscitar, a modelo tem que refazer o login. É o tipo de coisa
 * que não dá sinal nenhum até o dia em que todas as contas param juntas, dois
 * meses depois de alguém ter mexido pela última vez.
 *
 * Por isso a renovação é feita com muita folga: a partir de 20 dias de uso
 * (40 restantes). Sobra mais de um mês de tentativas diárias antes do prazo —
 * um servidor fora do ar por uma semana não derruba conta nenhuma.
 *
 * A Meta recusa renovar token com menos de 24 horas de vida, então conta
 * recém-conectada é pulada em silêncio (não é erro).
 */

const SESSENTA_DIAS = 60 * 24 * 60 * 60 * 1000;
/** Renova quando faltar menos que isto para vencer. */
const FOLGA_MS = 40 * 24 * 60 * 60 * 1000;
/** A Meta não renova token mais novo que isto. */
const IDADE_MINIMA_MS = 25 * 60 * 60 * 1000;

export async function runInstagramTokenRefresh(): Promise<{ renovados: number; falhas: number }> {
  let renovados = 0;
  let falhas = 0;

  for (const conta of listAccounts()) {
    if (!conta.tokenExpiresAt) continue;
    const restante = conta.tokenExpiresAt - Date.now();

    // Já morreu: não adianta tentar, e deixar como "connected" faria a tela
    // mentir enquanto nenhuma DM é respondida.
    if (restante <= 0) {
      if (conta.status !== "expired") {
        setAccountStatus(
          conta.id,
          "expired",
          "O token venceu. A modelo precisa refazer o login para reconectar.",
        );
      }
      continue;
    }
    if (restante > FOLGA_MS) continue;
    // Idade = 60 dias menos o que falta. Recém-conectada, a Meta recusaria.
    if (SESSENTA_DIAS - restante < IDADE_MINIMA_MS) continue;

    const token = getAccountToken(conta.id);
    if (!token) {
      setAccountStatus(conta.id, "error", "Sem token guardado — reconecte a conta.");
      falhas++;
      continue;
    }
    try {
      const novo = await renovarToken(token);
      setAccountToken(conta.id, novo.accessToken, novo.expiresIn);
      renovados++;
    } catch (err) {
      falhas++;
      // NÃO marca como erro: ainda há semanas de folga e a falha pode ser rede.
      // Marcar aqui acenderia alarme na tela por um soluço passageiro.
      console.error(`[hotdash] falha renovando token do Instagram (${conta.username || conta.id}):`, err);
    }
  }

  limparEventosAntigos();
  return { renovados, falhas };
}
