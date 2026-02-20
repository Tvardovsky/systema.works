import path from 'path';
import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const projectRoot = __dirname;
const tailwindcssPath = path.join(projectRoot, 'node_modules/tailwindcss');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      tailwindcss: tailwindcssPath
    }
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      tailwindcss: tailwindcssPath
    };
    return config;
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
