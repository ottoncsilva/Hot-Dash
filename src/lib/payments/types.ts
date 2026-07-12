// Interfaces comuns dos provedores de pagamento.

export type ChargeInput = {
  amountCents: number;
  description?: string;
  /** Dias até o PIX expirar (padrão 1). */
  expiresInDays?: number;
  /** Referência externa (id do pedido no seu sistema). */
  externalRef?: string;
  /** URL de webhook para confirmação do pagamento. */
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
  /** Metadados opcionais repassados ao provedor. */
  metadata?: {
    userEmail?: string;
    sellUrl?: string;
    orderUrl?: string;
  };
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
  raw?: unknown;
};

export interface PaymentProvider {
  readonly key: "syncpay" | "stripe";
  /** Cria uma cobrança PIX (ou o método padrão do provedor). */
  createPixCharge(input: ChargeInput): Promise<ChargeResult>;
  /** Saldo disponível na conta do provedor (quando suportado). */
  getBalance?(): Promise<BalanceResult | null>;
}
