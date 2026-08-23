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
  async redirects() {
    return [
      { source: "/dashboard/whatsapp", destination: "/dashboard/ltv/whatsapp", permanent: false },
      { source: "/dashboard/whatsapp/chat", destination: "/dashboard/ltv/chat", permanent: false },
      { source: "/dashboard/whatsapp/settings", destination: "/dashboard/ltv/whatsapp", permanent: false },
    ];
  },
};

export default nextConfig;
