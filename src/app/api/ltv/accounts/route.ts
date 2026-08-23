import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import * as uazapi from "@/lib/uazapi";
import { publicOrigin } from "@/lib/publicOrigin";
import { desconectarChip, isChipConfigurado, statusChip } from "@/lib/telegramChip";
import {
  createAccount,
  deleteAccount,
  getAccount,
  getAccountSession,
  listAccounts,
  updateAccount,
  type LtvAccount,
  type LtvChannel,
} from "@/lib/ltvDb";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canal(v: string | null): LtvChannel {
  return v === "telegram" ? "telegram" : "whatsapp";
}

/**
 * Contas de LTV da modelo. No WhatsApp são vários números; no Telegram, um
 * chip só — a regra vive em `createAccount` e num índice do banco, não aqui.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const profileId = url.searchParams.get("profileId");
    if (!profileId) throw new ApiError(400, "Informe a modelo.");

    const canalPedido = url.searchParams.get("channel");
    const contas = listAccounts(profileId, canalPedido ? canal(canalPedido) : undefined);

    // O status guardado envelhece: a instância pode ter caído sozinha. Quem
    // sabe a verdade é o provedor, então confere ao abrir a tela.
    const atualizadas = await Promise.all(
      contas.map(async (c) => {
        if (c.channel === "whatsapp") {
          const token = tokenDe(c);
          if (!token) return c;
          try {
            const inst = await uazapi.statusInstancia(token);
            // "connected" é o único estado em que dá para responder lead;
            // hibernated e connecting viram desconectado para a tela não
            // prometer o que não entrega.
            const status = inst.status === "connected" ? ("connected" as const) : ("disconnected" as const);
            if (status !== c.status || (inst.owner && inst.owner !== c.externalRef)) {
              updateAccount(c.id, { status, externalRef: inst.owner || c.externalRef });
            }
            return { ...c, status, externalRef: inst.owner || c.externalRef };
          } catch {
            // Servidor fora do ar não é motivo para mentir na tela.
            return c;
          }
        }
        if (c.channel === "telegram" && isChipConfigurado()) {
          const s = await statusChip(c.id);
          return { ...c, status: s.status };
        }
        return c;
      }),
    );

    return NextResponse.json({
      accounts: atualizadas,
      chipConfigurado: isChipConfigurado(),
      uazapiConfigurada: uazapi.isUazapiConfigurada(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const profileId = String(body.profileId || "");
    if (!profileId) throw new ApiError(400, "Informe a modelo.");
    const channel = canal(body.channel);

    const conta = createAccount({ profileId, channel, label: body.label });
    return NextResponse.json({ account: conta });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Ações da conta. O `connect` do WhatsApp devolve o QR; o do Telegram é outro
 * fluxo (telefone e código) e vive em /api/ltv/telegram/session.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const accountId = String(body.accountId || "");
    const conta = getAccount(accountId);
    if (!conta) throw new ApiError(404, "Conta não encontrada.");

    if (body.action === "rename") {
      updateAccount(conta.id, { label: String(body.label || conta.label) });
      return NextResponse.json({ account: getAccount(conta.id) });
    }

    if (body.action === "connect") {
      if (conta.channel !== "whatsapp") {
        throw new ApiError(400, "O chip do Telegram conecta por telefone e código.");
      }

      // A instância é criada UMA vez e o token dela fica cifrado na conta. Se
      // já existe, reconectar reaproveita o mesmo token — criar outra
      // instância a cada QR estouraria o limite de dispositivos do plano.
      let token = tokenDe(conta);
      if (!token) {
        const perfil = getDb()
          .prepare(`SELECT name FROM profiles WHERE id = ?`)
          .get(conta.profileId) as { name?: string } | undefined;
        const slug = (perfil?.name || "modelo")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const inst = await uazapi.criarInstancia(`hotdash_${slug}_${conta.id.slice(0, 8)}`);
        token = inst.token;
        // O id da instância é o que o webhook usa para achar esta conta.
        updateAccount(conta.id, {
          sessionEnc: encryptSecret(token),
          providerRef: inst.id,
          status: "connecting",
        });
      }

      // O webhook é registrado a cada conexão, não só na criação: se o
      // endereço público do painel mudar, reconectar conserta sozinho.
      await uazapi.registrarWebhook(token, `${publicOrigin(req)}/api/webhooks/uazapi`);

      // Com telefone vem código de pareamento (digitar no aparelho), sem
      // telefone vem QR. Pareamento é mais fácil para quem só tem o celular.
      const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
      const inst = await uazapi.conectarInstancia(token, phone || undefined);
      updateAccount(conta.id, {
        status: "connecting",
        externalRef: phone || conta.externalRef,
      });
      return NextResponse.json({
        status: "connecting",
        qrcode: inst.qrcode || null,
        paircode: inst.paircode || null,
      });
    }

    if (body.action === "disconnect") {
      if (conta.channel === "telegram") {
        await desconectarChip(conta.id);
      } else {
        const token = tokenDe(conta);
        if (token) {
          try {
            await uazapi.desconectarInstancia(token);
          } catch {
            // A instância pode nem existir mais lá. O painel precisa sair do
            // "conectado" de qualquer jeito, senão a tela mente.
          }
        }
        // O token SOBREVIVE ao desconectar: é a mesma instância, só sem
        // sessão. Apagá-lo forçaria criar outra e queimaria uma vaga do plano.
        updateAccount(conta.id, { status: "disconnected" });
      }
      return NextResponse.json({ account: getAccount(conta.id) });
    }

    throw new ApiError(400, "Ação desconhecida.");
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireUser(req);
    const accountId = new URL(req.url).searchParams.get("accountId") || "";
    const conta = getAccount(accountId);
    if (!conta) throw new ApiError(404, "Conta não encontrada.");

    // Apagar a conta leva junto conversa, produtos e vendas (ON DELETE
    // CASCADE). Encerrar antes evita deixar instância órfã ocupando vaga do
    // plano da uazapi, ou o chip logado num serviço que já não tem dono aqui.
    if (conta.channel === "telegram") {
      await desconectarChip(conta.id).catch(() => {});
    } else {
      const token = tokenDe(conta);
      if (token) await uazapi.apagarInstancia(token).catch(() => {});
    }
    deleteAccount(conta.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Token da instância na uazapi, decifrado. `null` = número nunca conectado. */
function tokenDe(conta: LtvAccount): string | null {
  const enc = getAccountSession(conta.id);
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    // Chave-mestra trocada: o token virou lixo e a instância precisa nascer
    // de novo. Melhor isso do que mandar credencial ilegível.
    return null;
  }
}
