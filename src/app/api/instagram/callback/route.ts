import { NextRequest, NextResponse } from "next/server";
import {
  assinarWebhooks,
  conferirState,
  dadosDaConta,
  tokenLongo,
  trocarCodePorToken,
} from "@/lib/instagram/api";
import { setAccountStatus, upsertAccount } from "@/lib/instagram/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O retorno do login do Instagram.
 *
 * NÃO exige sessão do painel, e é proposital: quem abre este link é a MODELO,
 * no celular dela, possivelmente sem conta no Hot-Dash. O que autoriza a
 * gravação não é um login nosso — é o `state` assinado por nós na ida e a posse
 * do `code`, que só a Meta entrega e que vale uma vez só.
 *
 * Termina com um HTML simples em vez de um JSON: quem está olhando é uma
 * pessoa, no navegador, e precisa saber se deu certo.
 */

function pagina(titulo: string, texto: string, ok: boolean): NextResponse {
  const cor = ok ? "#34d399" : "#f87171";
  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${titulo}</title></head>
     <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0d;color:#e4e4e7;font-family:system-ui,-apple-system,sans-serif">
       <div style="max-width:26rem;padding:2rem;text-align:center">
         <p style="font-size:2.5rem;margin:0 0 .5rem">${ok ? "✅" : "⚠️"}</p>
         <h1 style="font-size:1.1rem;margin:0 0 .75rem;color:${cor}">${titulo}</h1>
         <p style="font-size:.9rem;line-height:1.5;color:#a1a1aa;margin:0">${texto}</p>
       </div>
     </body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // A modelo clicou em "cancelar" na tela do Instagram.
  const erro = sp.get("error_description") || sp.get("error");
  if (erro) return pagina("Conexão cancelada", "Nada foi salvo. É só tentar de novo pelo painel.", false);

  const code = sp.get("code");
  const state = sp.get("state") || "";
  if (!code) return pagina("Link incompleto", "Faltou o código de autorização. Peça um link novo no painel.", false);

  const profileId = conferirState(state);
  if (!profileId) {
    return pagina(
      "Link expirado",
      "Este link de conexão não vale mais (ele dura 1 hora). Gere outro no painel e abra de novo.",
      false,
    );
  }

  try {
    // O `code` vale UMA vez: a troca vem primeiro e o resultado é gravado antes
    // de qualquer outra coisa poder falhar. Um F5 nesta página depois disso
    // encontraria um código já queimado.
    const curto = await trocarCodePorToken(code);
    const longo = await tokenLongo(curto.accessToken);

    let username: string | undefined;
    try {
      username = (await dadosDaConta(longo.accessToken)).username;
    } catch {
      // Enfeite: a conta conecta sem o @, e o tique de fundo pega depois.
    }

    const conta = upsertAccount({
      profileId,
      igUserId: curto.userId,
      username,
      token: longo.accessToken,
      expiresInS: longo.expiresIn,
    });

    // A ASSINATURA DOS WEBHOOKS é o que faz as DMs chegarem. Sem ela a conta
    // aparece conectada e nada acontece — por isso a falha aqui NÃO é
    // silenciosa: fica gravada no status para a tela poder cobrar.
    try {
      await assinarWebhooks(conta.igUserId, longo.accessToken);
    } catch (e) {
      setAccountStatus(
        conta.id,
        "error",
        `Conectou, mas não foi possível assinar o recebimento de mensagens: ${
          e instanceof Error ? e.message : "falha"
        }`,
      );
      return pagina(
        "Conectado pela metade",
        "A conta foi ligada, mas o recebimento de mensagens não pôde ser ativado. Avise quem cuida do painel.",
        false,
      );
    }

    return pagina(
      "Conta conectada!",
      `${username ? "@" + username : "A conta"} já está ligada ao painel. Pode fechar esta página.`,
      true,
    );
  } catch (err) {
    return pagina(
      "Não deu para conectar",
      err instanceof Error ? err.message : "Tente de novo pelo painel.",
      false,
    );
  }
}
