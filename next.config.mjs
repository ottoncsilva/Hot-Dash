/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gera um build standalone para uma imagem Docker enxuta (EasyPanel).
  output: "standalone",
  reactStrictMode: true,
  // better-sqlite3 é um módulo nativo: não deve ser empacotado pelo webpack.
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    instrumentationHook: true,
  },
};

export default nextConfig;
