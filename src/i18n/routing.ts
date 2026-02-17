import {defineRouting} from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'sr-ME', 'ru', 'uk'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: true
});

export type AppLocale = (typeof routing.locales)[number];
