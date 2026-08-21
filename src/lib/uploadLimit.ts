/**
 * LIMITE DE UPLOAD — um número só, para o app inteiro.
 *
 * Estava repetido em cinco arquivos, e um deles (a censura de vídeo) tinha um
 * valor próprio, menor. O resultado era o pior tipo de erro: a tela aceitava o
 * arquivo, a barra de progresso ia até o fim, e só então o servidor recusava —
 * com um número que a tela nunca mostrou.
 *
 * `NEXT_PUBLIC_` é obrigatório no nome: a validação acontece dos DOIS lados, e
 * o navegador precisa saber o limite antes de começar a subir meio giga para
 * ouvir "não". Como toda variável `NEXT_PUBLIC_*`, ela é embutida no BUILD —
 * mudá-la no runtime do EasyPanel não tem efeito sem um novo build.
 *
 * ⚠️ Este limite é do APP. Quem está na frente dele (Nginx/Traefik do
 * EasyPanel, Cloudflare) tem o seu próprio, e o menor dos dois é o que vale.
 * Um 413 sem mensagem nossa vem de lá — ver `lib/api.ts`.
 */
export const MAX_UPLOAD_MB = (() => {
  const mb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "500");
  return Number.isFinite(mb) && mb > 0 ? mb : 500;
})();

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
