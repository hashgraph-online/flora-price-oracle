/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NEXT_DISABLE_TURBOPACK = '1';
process.env.NEXT_FORCE_WEBPACK = '1';
process.env.TURBOPACK = '0';
process.env.NEXT_PRIVATE_BUILD_WITH_TURBOPACK = '0';
process.env.NEXT_PRIVATE_RENDER_WITH_TURBOPACK = '0';
process.env.NEXT_PRIVATE_PREFLIGHT_WITH_TURBOPACK = '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typedRoutes: true,
};

export default nextConfig;
