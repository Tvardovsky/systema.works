import type {MetadataRoute} from 'next';
import {routing} from '@/i18n/routing';
import {getLanguageAlternates, getLocaleUrl} from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const alternates = getLanguageAlternates();
  const now = new Date();

  return routing.locales.map((locale) => ({
    url: getLocaleUrl(locale),
    lastModified: now,
    changeFrequency: 'weekly',
    priority: locale === 'en' ? 1 : 0.9,
    alternates: {
      languages: alternates
    }
  }));
}

export const revalidate = 86400;
export const dynamic = 'force-static';
