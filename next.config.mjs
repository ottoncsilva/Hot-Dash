/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gera um build standalone para uma imagem Docker enxuta (EasyPanel).
  output: "standalone",
  reactStrictMode: true,
  // better-sqlite3 é um módulo nativo: não deve ser empacotado pelo webpack.
  experimental: {
    // Módulos nativos: não devem ser empacotados pelo webpack (usam .node).
    // GramJS entra aqui porque o chip do Telegram roda no processo do servidor:
    // empacotá-lo pelo webpack quebra o carregamento dos módulos de criptografia
    // que ele resolve em tempo de execução.
    serverComponentsExternalPackages: [
      "better-sqlite3",
      "onnxruntime-node",
      "sharp",
      "telegram",
    ],
    instrumentationHook: true,
  },
  // O LTV do WhatsApp virou submenu de LTV. Quem tem o caminho antigo salvo
  // (favorito, atalho na tela do celular, link colado numa conversa) não pode
  // cair num 404 — o painel é usado do celular o dia inteiro.
  /**
   * O SERVICE WORKER nunca pode vir de cache.
   *
   * O navegador só descobre que há uma versão nova do app instalado ao
   * rebuscar `/sw.js`; se um proxy ou o próprio Chrome guardar o arquivo, o
   * PWA fica preso na versão antiga sem nada avisar. `max-age=0` com
   * `must-revalidate` obriga a conferir com o servidor em toda visita — é um
   * arquivo de 2 KB, o custo é nenhum.
   *
   * O manifesto entra pelo mesmo motivo: é dele que saem nome, ícone e
   * atalhos, e um manifesto velho em cache mantém o ícone velho na área de
   * trabalho.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/dashboard/whatsapp", destination: "/dashboard/ltv/whatsapp", permanent: false },
      { source: "/dashboard/whatsapp/chat", destination: "/dashboard/ltv/chat", permanent: false },
      { source: "/dashboard/whatsapp/settings", destination: "/dashboard/ltv/whatsapp", permanent: false },
    ];
  },
};

export default nextConfig;
