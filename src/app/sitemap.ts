import type {MetadataRoute} from 'next';
import {routing} from '@/i18n/routing';
import {SITE_URL} from '@/lib/seo';

const PAGES = ['', '/privacy', '/terms'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap((page) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${page}`,
      lastModified: new Date('2026-10-06'),
      changeFrequency: page === '' ? ('monthly' as const) : ('yearly' as const),
      priority: page === '' ? (locale === 'en' ? 1 : 0.9) : 0.3,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [l, `${SITE_URL}/${l}${page}`]))
      }
    }))
  );
}
