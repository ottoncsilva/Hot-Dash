/**
 * Rede/origem de tráfego de uma página do SLT (link na bio) — classificação
 * MANUAL do operador (ver `slt_page_profiles.traffic_source`), não algo que
 * a API do SLT devolve. Fica num arquivo à parte, sem "server-only", porque
 * tanto a rota (`/api/links`) quanto a tela (`/dashboard/links`, client)
 * precisam da MESMA lista — duas cópias já divergiram no passado noutras
 * telas deste painel.
 */
export const SLT_NETWORKS: { key: string; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "telegram", label: "Telegram" },
  { key: "tiktok", label: "TikTok" },
  { key: "ads", label: "Anúncios" },
  { key: "outro", label: "Outro" },
];

export function sltNetworkLabel(key: string | null | undefined): string {
  return SLT_NETWORKS.find((n) => n.key === key)?.label || "";
}
