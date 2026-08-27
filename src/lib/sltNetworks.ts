/**
 * Tipo compartilhado da rede/origem de tráfego de uma página do SLT (link na
 * bio) — classificação MANUAL do operador (ver `slt_page_profiles.
 * traffic_source`), cadastrada em Configurações → Links da Bio.
 *
 * Sem "server-only" de propósito: tanto a rota (`/api/links`) quanto a tela
 * (`/dashboard/links`, client) usam este tipo, e as duas nunca podem ver
 * cópias divergentes dele. O CADASTRO em si (ler/criar/apagar do banco) mora
 * em `lib/sltNetworksStore.ts`, que É server-only.
 */
export type SltNetwork = { id: string; key: string; label: string };
