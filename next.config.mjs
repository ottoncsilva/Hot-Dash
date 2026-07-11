/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gera um build standalone para uma imagem Docker enxuta (EasyPanel).
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
