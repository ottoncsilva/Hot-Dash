import "server-only";
import type { NextRequest } from "next/server";

/**
 * Base PÚBLICA do app — a raiz das URLs que um serviço externo (Telegram,
 * SyncPay) precisa alcançar de fora para nos entregar um evento.
 *
 * Por que isto não é `req.nextUrl.origin`: em produção o app roda em modo
 * standalone dentro do container, com `HOSTNAME=0.0.0.0` (ver Dockerfile).
 * Quando o proxy reverso (EasyPanel) não repassa um `Host` utilizável, o Next
 * monta o origin a partir do próprio endereço de bind e devolve
 * `http://0.0.0.0:3000`. Registrar o webhook com essa URL faz o Telegram
 * recusar na cara — "Bad Request: bad webhook: IP address 0.0.0.0 is reserved"
 * — e, no caso da SyncPay, é pior: a cobrança é criada, o cliente paga e a
 * confirmação nunca chega, então a venda some do painel.
 *
 * A resolução tenta, em ordem:
 *   1. WEBHOOK_APP_URL / NEXT_PUBLIC_APP_URL (o que o operador configurou);
 *   2. os cabeçalhos do proxy (`x-forwarded-host` + `x-forwarded-proto`);
 *   3. o cabeçalho `Host` da requisição;
 *   4. `req.nextUrl.origin`, como último recurso.
 * Candidatos que apontam para endereço reservado/local são pulados — é melhor
 * seguir para o próximo do que devolver uma URL que ninguém alcança.
 *
 * ⚠️ `NEXT_PUBLIC_APP_URL` é embutida no BUILD (comportamento do Next para
 * qualquer `NEXT_PUBLIC_*`), então defini-la só no runtime do EasyPanel não
 * tem efeito. Para configurar sem rebuild, use `WEBHOOK_APP_URL`.
 */

/** Normaliza uma base: garante esquema, remove barra final e caminho vazio. */
function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Endereço que só existe dentro da máquina/rede interna e por isso nunca
 * poderia receber uma chamada vinda da internet.
 */
function isReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // IPv6 loopback / qualquer-endereço.
  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
  // Nome sem ponto (ex.: `app`, `hotdash`): é nome de serviço do Docker, não
  // um domínio público.
  if (!host.includes(".")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0) return true; // 0.0.0.0/8 — o caso que quebrou o setWebhook
    if (a === 127) return true; // loopback
    if (a === 10) return true; // privado
    if (a === 172 && b >= 16 && b <= 31) return true; // privado
    if (a === 192 && b === 168) return true; // privado
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    // Um IP público cru até funcionaria para a SyncPay, mas o Telegram exige
    // HTTPS com certificado — na prática só um domínio serve. Vale como
    // candidato mesmo assim; quem valida o resto é `webhookOriginProblem`.
  }
  return false;
}

/**
 * A base é alcançável da INTERNET? Mais frouxo que `webhookOriginProblem`:
 * não exige HTTPS nem porta do Telegram — só que o host não seja interno.
 * É o que basta para um serviço externo baixar um arquivo nosso (o Motion
 * Control manda a Magnific buscar a foto e o vídeo por link).
 */
export function origemAlcancavel(origin: string): boolean {
  try {
    return !isReservedHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Um candidato serve como base pública? */
function isUsableOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  try {
    return !isReservedHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** A base configurada em variável de ambiente, se houver. */
function envOrigin(): string | null {
  const raw = process.env.WEBHOOK_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  return normalizeOrigin(raw);
}

/**
 * A base pública para quem NÃO tem uma requisição em mãos — o agente de LTV
 * responde a partir de um webhook, e o postback da SyncPay e o link da mídia
 * que o chip vai baixar precisam de um endereço que a internet alcance.
 * Sem `WEBHOOK_APP_URL` não há como adivinhar, então falha dizendo o que fazer.
 */
export function publicOriginSemRequest(): string {
  const origin = envOrigin();
  if (!origin) {
    throw new Error(
      "Endereço público do painel desconhecido. Defina WEBHOOK_APP_URL com o domínio do painel.",
    );
  }
  return origin;
}

export type OriginSource = "env" | "proxy" | "host" | "request";

/** A base pública escolhida e de onde ela veio (para a UI explicar o estado). */
export function resolvePublicOrigin(req: NextRequest): {
  origin: string;
  source: OriginSource;
} {
  const candidates: { origin: string | null; source: OriginSource }[] = [];

  candidates.push({ origin: envOrigin(), source: "env" });

  // Cabeçalhos do proxy reverso. `x-forwarded-host` pode vir como lista
  // ("publico.com, interno:3000") — o primeiro é o que o cliente pediu.
  const fwdHost = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const fwdProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (fwdHost) {
    candidates.push({
      origin: normalizeOrigin(`${fwdProto || "https"}://${fwdHost}`),
      source: "proxy",
    });
  }

  const hostHeader = (req.headers.get("host") || "").trim();
  if (hostHeader) {
    candidates.push({
      origin: normalizeOrigin(`${fwdProto || "https"}://${hostHeader}`),
      source: "host",
    });
  }

  candidates.push({ origin: normalizeOrigin(req.nextUrl.origin), source: "request" });

  for (const candidate of candidates) {
    if (isUsableOrigin(candidate.origin)) {
      return { origin: candidate.origin, source: candidate.source };
    }
  }

  // Nada serve: devolve o último recurso mesmo assim, para quem chama poder
  // mostrar exatamente qual URL inútil seria usada.
  return {
    origin: normalizeOrigin(req.nextUrl.origin) || req.nextUrl.origin.replace(/\/+$/, ""),
    source: "request",
  };
}

/**
 * Base pública do app (sem barra no fim). Mantém a assinatura antiga usada
 * pelas rotas que montam URLs de postback.
 */
export function publicOrigin(req: NextRequest): string {
  return resolvePublicOrigin(req).origin;
}

/**
 * O que impede esta base de receber o webhook do TELEGRAM, se algo impedir.
 * Devolve `null` quando está tudo certo, ou uma frase pronta para a UI.
 *
 * O Telegram é o mais exigente dos dois provedores: só aceita HTTPS, recusa
 * endereço reservado e só admite as portas 443, 80, 88 e 8443.
 */
export function webhookOriginProblem(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `Endereço público inválido (${origin}).`;
  }

  const comoConfigurar =
    "Defina a variável de ambiente WEBHOOK_APP_URL com o domínio público do painel " +
    "(ex.: https://painel.seudominio.com) e reinicie o app.";

  if (isReservedHost(url.hostname)) {
    return (
      `O app resolveu o próprio endereço como ${origin}, que é um endereço interno — ` +
      `o Telegram não consegue alcançá-lo. ${comoConfigurar}`
    );
  }
  if (url.protocol !== "https:") {
    return (
      `O Telegram só aceita webhook em HTTPS, e o endereço resolvido foi ${origin}. ` +
      comoConfigurar
    );
  }
  const port = url.port;
  if (port && !["443", "80", "88", "8443"].includes(port)) {
    return (
      `O Telegram só aceita as portas 443, 80, 88 e 8443, e o endereço resolvido usa a ${port}. ` +
      comoConfigurar
    );
  }
  return null;
}
