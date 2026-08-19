import "server-only";

/**
 * Erros de MODERAÇÃO dos geradores, traduzidos.
 *
 * A OpenRouter repassa o erro do provedor de origem embrulhado dentro da
 * mensagem dela — o que chegava na tela era o JSON inteiro da ByteDance,
 * ilegível ("HTTP 400: {"error":{"code":"InputImage...").  Aqui esse texto
 * vira uma frase que diz O QUE foi recusado e por quê.
 *
 * É comum aos dois geradores (imagem e vídeo) porque a moderação é do
 * provedor, não do endpoint.
 */

/**
 * Reconhece as recusas de moderação que têm causa conhecida. Devolve null
 * quando não é uma delas — aí quem chamou usa a mensagem genérica do 400.
 */
export function mensagemDeModeracao(apiMsg: string): string | null {
  const m = apiMsg.toLowerCase();

  // Proteção contra deepfake: o provedor achou que a imagem enviada pode ser
  // uma pessoa real. Vale para o primeiro frame do vídeo e para as
  // referências da imagem.
  if (
    m.includes("privacyinformation") ||
    m.includes("may contain real person") ||
    m.includes("inputimagesensitivecontentdetected")
  ) {
    return (
      "A imagem enviada foi recusada pela moderação do provedor, que suspeitou ser uma pessoa " +
      "real — é a proteção contra deepfake, e ela erra para o lado seguro. Use um frame gerado " +
      "por IA (por exemplo, uma imagem criada no Gerador de Imagem), que nasce sem foto de origem."
    );
  }

  // Conteúdo do prompt ou da imagem barrado por política de conteúdo.
  if (m.includes("sensitive") || m.includes("moderation") || m.includes("content policy")) {
    return (
      "O provedor barrou este pedido por política de conteúdo. Ajuste o prompt ou troque a " +
      "imagem de referência."
    );
  }

  return null;
}
