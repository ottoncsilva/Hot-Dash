// Interfaces comuns dos provedores de pagamento.

export type ChargeInput = {
  amountCents: number;
  description?: string;
  customer?: {
    name?: string;
    email?: string;
    document?: string; // CPF/CNPJ
    phone?: string;
  };
};

export type ChargeResult = {
  providerRef: string;
  status: "pending" | "paid" | "failed";
  /** Código copia-e-cola do PIX (quando aplicável). */
  pixCode?: string;
  /** URL de checkout/pagamento (quando aplicável). */
  checkoutUrl?: string;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly key: "syncpay" | "stripe";
  /** Cria uma cobrança PIX (ou o método padrão do provedor). */
  createPixCharge(input: ChargeInput): Promise<ChargeResult>;
}
