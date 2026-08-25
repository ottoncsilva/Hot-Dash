import "server-only";
import Stripe from "stripe";
import { publicOriginSemRequest } from "../publicOrigin";
import type { ChargeInput, ChargeResult, PaymentProvider } from "./types";

/**
 * Adaptador Stripe — cartão em moeda estrangeira, para leads de fora do
 * Brasil. Dois modos, escolhidos por `input.recurring`:
 *
 *   • AUSENTE (padrão) → `mode: "payment"`, cobrança avulsa por ciclo — o
 *     motor de renovação/downsell que já existe cuida da virada, igual ao
 *     PIX hoje.
 *   • PRESENTE → `mode: "subscription"`, a Stripe cobra o cartão sozinha a
 *     cada ciclo (ver `recurringFromDurationDays` em `telegramDb.ts` pra
 *     quem decide isso). `session.subscription`/`session.customer` só
 *     existem DEPOIS do pagamento — o webhook (`checkout.session.completed`)
 *     é quem grava esses ids na inscrição local.
 *
 * `providerRef = session.id` é o mesmo mecanismo do PIX nos dois modos: a
 * transação `pending` é pré-criada com esse `providerRef`, e o webhook
 * (`/api/webhooks/stripe`) só faz `updateStatusByRef("stripe", providerRef, ...)`.
 */

/**
 * `price_data.product_data` cria um Produto NOVO na Stripe a cada cobrança
 * (não reaproveita um cadastrado antes) — e o nome dele aparece na página de
 * checkout e no dashboard da Stripe. Por isso é sempre um rótulo genérico e
 * fixo, nunca o nome/descrição do plano (que poderia expor a modelo ou o
 * conteúdo vendido para quem olha o dashboard da Stripe). Configurável por
 * `STRIPE_PRODUCT_NAME` só para o operador poder trocar o texto sem deploy;
 * o padrão já é genérico o bastante para não precisar mexer.
 */
const NOME_PRODUTO_GENERICO = (process.env.STRIPE_PRODUCT_NAME || "Digital Access").trim();

export function createStripe(creds: { secretKey: string; webhookSecret: string }): PaymentProvider {
  const stripe = new Stripe(creds.secretKey);

  return {
    key: "stripe",

    async createCharge(input: ChargeInput): Promise<ChargeResult> {
      const origin = publicOriginSemRequest();
      const moeda = (input.currency || "USD").toLowerCase();
      const recurring = input.recurring;
      const session = await stripe.checkout.sessions.create({
        mode: recurring ? "subscription" : "payment",
        // SEM `payment_method_types` de propósito: travar em ["card"] esconde
        // Apple Pay/Google Pay/Link mesmo com os três habilitados no
        // Dashboard (Configurações → Formas de pagamento). Omitido, o
        // Checkout decide sozinho, por sessão, o que mostrar — a mesma
        // config "dinâmica" que a Stripe já usa para Payment Links.
        line_items: [
          {
            price_data: {
              currency: moeda,
              unit_amount: input.amountCents,
              product_data: { name: NOME_PRODUTO_GENERICO },
              // `recurring` só é aceito pela API quando `mode: "subscription"`
              // — omitido (undefined) em `mode: "payment"`, exatamente como
              // já era antes desta função saber lidar com assinatura.
              ...(recurring
                ? { recurring: { interval: recurring.interval, interval_count: recurring.intervalCount } }
                : {}),
            },
            quantity: 1,
          },
        ],
        customer_email: input.customer?.email || undefined,
        metadata: input.metadata || {},
        success_url: `${origin}/checkout/stripe/obrigado`,
        cancel_url: `${origin}/checkout/stripe/cancelado`,
      });

      return {
        providerRef: session.id,
        status: "pending",
        checkoutUrl: session.url || undefined,
        raw: session,
      };
    },

    async getBalance() {
      const bal = await stripe.balance.retrieve();
      // Só a entrada em USD — a conta pode ter outras moedas na lista (ex.:
      // o saldo padrão do país da conta), e somar valores em moedas
      // diferentes sem converter misturaria centavos de unidades distintas.
      // Este app só cobra em USD pela Stripe, então é a única que importa.
      const somaUsd = (lista: { amount: number; currency: string }[]) =>
        lista.filter((b) => b.currency === "usd").reduce((acc, b) => acc + b.amount, 0);
      return {
        availableCents: somaUsd(bal.available),
        pendingCents: somaUsd(bal.pending),
        raw: bal,
      };
    },
  };
}

/**
 * Link do Billing Portal ("Gerenciar assinatura") — é por aí que o cliente
 * cancela sozinho uma assinatura automática, sem precisar falar com a
 * modelo. Sem esse caminho de autoatendimento, cancelamento vira
 * contestação/chargeback no cartão.
 *
 * O Portal exige uma CONFIGURAÇÃO cadastrada na conta antes de gerar
 * sessão — conta nova não tem nenhuma. Em vez de depender de um passo
 * manual no Dashboard antes do recurso funcionar, cria uma configuração
 * padrão (permite cancelar, sem forçar troca de plano) na primeira vez que
 * a conta ainda não tiver uma.
 */
export async function createBillingPortalSession(
  creds: { secretKey: string },
  customerId: string,
  returnUrl: string,
): Promise<string | null> {
  const stripe = new Stripe(creds.secretKey);
  try {
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return session.url;
  } catch {
    // Provavelmente falta configuração — confere e cria a padrão só se for
    // isso mesmo (uma falha por outro motivo, ex.: customerId inválido,
    // não se resolve criando configuração, então não tenta de novo à toa).
    try {
      const existentes = await stripe.billingPortal.configurations.list({ limit: 1 });
      if (existentes.data.length === 0) {
        await stripe.billingPortal.configurations.create({
          features: {
            subscription_cancel: { enabled: true, mode: "at_period_end" },
            invoice_history: { enabled: true },
          },
        });
      } else {
        return null;
      }
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return session.url;
    } catch {
      return null;
    }
  }
}

/** Testa credenciais sem afetar cache/estado de nenhum provider já instanciado. */
export async function testStripeCredentials(
  secretKey: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const stripe = new Stripe(secretKey);
    await stripe.balance.retrieve();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "falha ao conectar com a Stripe",
    };
  }
}
