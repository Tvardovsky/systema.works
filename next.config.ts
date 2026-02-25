import path from 'path';
import os from 'os';
import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const projectRoot = __dirname;
const tailwindcssPath = path.join(projectRoot, 'node_modules/tailwindcss');

function getLanDevOrigins(): string[] {
  type InterfaceAddress = {
    address: string;
    family: string | number;
    internal: boolean;
  };

  const interfaces = os.networkInterfaces() as Record<string, InterfaceAddress[] | undefined>;
  const origins = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      const family = String(entry.family);
      if (entry.internal || (family !== 'IPv4' && family !== '4')) {
        continue;
      }
      origins.add(entry.address);
    }
  }

  const envOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const origin of envOrigins) {
    origins.add(origin);
  }

  return Array.from(origins);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: getLanDevOrigins(),
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
