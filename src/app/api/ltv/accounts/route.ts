import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireUser } from "@/lib/apiAuth";
import { getDb } from "@/lib/db";
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  getStateEvolutionInstance,
  logoutEvolutionInstance,
  setEvolutionWebhook,
} from "@/lib/evolution";
import { publicOrigin } from "@/lib/publicOrigin";
import { desconectarChip, isChipConfigurado, statusChip } from "@/lib/telegramChip";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
  type LtvChannel,
} from "@/lib/ltvDb";

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
        if (c.channel === "whatsapp" && c.externalRef) {
          const state = await getStateEvolutionInstance(c.externalRef);
          const conectada = state?.instance?.state === "open";
          const status = conectada ? ("connected" as const) : ("disconnected" as const);
          if (status !== c.status) updateAccount(c.id, { status });
          return { ...c, status };
        }
        if (c.channel === "telegram" && isChipConfigurado()) {
          const s = await statusChip(c.id);
          return { ...c, status: s.status };
        }
        return c;
      }),
    );

    return NextResponse.json({ accounts: atualizadas, chipConfigurado: isChipConfigurado() });
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
      const webhookUrl = `${publicOrigin(req)}/api/webhooks/evolution`;
      let instanceName = conta.externalRef;
      let qrcode: string | null = null;

      if (!instanceName) {
        // O nome precisa ser único por CONTA, não por modelo: a mesma modelo
        // pode ter Número 1 e Número 2, e um nome só faria o segundo QR
        // derrubar o primeiro.
        const perfil = getDb()
          .prepare(`SELECT name FROM profiles WHERE id = ?`)
          .get(conta.profileId) as { name?: string } | undefined;
        const slug = (perfil?.name || "modelo")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        instanceName = `hotdash_${slug}_${conta.id.slice(0, 8)}`;
        const res = await createEvolutionInstance(instanceName);
        qrcode = res?.qrcode?.base64 || res?.base64 || null;
        await setEvolutionWebhook(instanceName, webhookUrl);
        updateAccount(conta.id, { externalRef: instanceName, status: "connecting" });
      } else {
        const res = await connectEvolutionInstance(instanceName);
        qrcode = res?.qrcode?.base64 || res?.base64 || res?.qrcode || null;
        await setEvolutionWebhook(instanceName, webhookUrl);
        updateAccount(conta.id, { status: "connecting" });
      }
      return NextResponse.json({ status: "connecting", qrcode });
    }

    if (body.action === "disconnect") {
      if (conta.channel === "telegram") {
        await desconectarChip(conta.id);
      } else if (conta.externalRef) {
        try {
          await logoutEvolutionInstance(conta.externalRef);
        } catch {
          // A instância pode já não existir na Evolution. O painel precisa
          // sair do "conectado" de qualquer jeito.
        }
        updateAccount(conta.id, { externalRef: null, status: "disconnected" });
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

    // Apagar a conta leva junto conversa, produto e venda (ON DELETE CASCADE).
    // Encerrar a sessão antes evita deixar o chip logado num serviço que já
    // não tem mais dono no painel.
    if (conta.channel === "telegram") {
      await desconectarChip(conta.id).catch(() => {});
    } else if (conta.externalRef) {
      await logoutEvolutionInstance(conta.externalRef).catch(() => {});
    }
    deleteAccount(conta.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
