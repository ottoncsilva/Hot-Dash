// Interfaces comuns dos provedores de pagamento.

export type ChargeInput = {
  amountCents: number;
  /** BRL (SyncPay/PIX) ou USD (Stripe). Ausente = BRL, comportamento de sempre. */
  currency?: "BRL" | "USD";
  description?: string;
  /** Dias até o PIX expirar (padrão 1). */
  expiresInDays?: number;
  /** Referência externa (id do pedido no seu sistema). */
  externalRef?: string;
  /** URL de webhook para confirmação do pagamento (SyncPay — a Stripe usa o
   *  webhook cadastrado uma vez no Dashboard dela, não por cobrança). */
  postbackUrl?: string;
  customer?: {
    name?: string;
    email?: string;
    document?: string; // CPF/CNPJ
    phone?: string;
    ip?: string;
    address?: {
      street?: string;
      streetNumber?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
    };
  };
  /** Metadados repassados ao provedor — na Stripe, viram `metadata` da
   *  Checkout Session (ex.: botId/telegramUserId/planId), usados como rede
   *  de segurança no webhook pra casar um pagamento sem transação pendente. */
  metadata?: Record<string, string>;
};

export type ChargeResult = {
  providerRef: string;
  status: "pending" | "paid" | "failed";
  /** Código copia-e-cola do PIX (quando aplicável). */
  pixCode?: string;
  /** QR code do PIX em Base64 (quando aplicável). */
  qrCodeBase64?: string;
  /** URL de checkout/pagamento (quando aplicável). */
  checkoutUrl?: string;
  raw?: unknown;
};

export type BalanceResult = {
  availableCents: number;
  /** Ainda não liberado pro saque (ex.: retenção padrão da Stripe até o
   *  repasse). Ausente = provedor não distingue os dois estados. */
  pendingCents?: number;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly key: "syncpay" | "stripe";
  /** Cria uma cobrança — PIX (código copia-e-cola) na SyncPay, link de
   *  checkout na Stripe. O chamador decide o que fazer olhando
   *  `ChargeResult.pixCode` vs `checkoutUrl`. */
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  /** Saldo disponível na conta do provedor (quando suportado). */
  getBalance?(): Promise<BalanceResult | null>;
  /** Webhooks cadastrados na conta do provedor. O evento assinado decide o que
   *  chega até nós — assinar "tudo" traz saque junto com venda. */
  listWebhooks?(): Promise<
    { id: number; title: string; url: string; event: string; allProducts: boolean }[]
  >;
  /** O que o provedor respondeu na consulta de saldo — para a tela de
   *  Configurações mostrar o motivo quando o saldo não vem. */
  diagnoseBalance?(): Promise<{
    cents: number | null;
    attempts: { path: string; httpStatus?: number; bodySample?: string; error?: string }[];
  }>;
}
