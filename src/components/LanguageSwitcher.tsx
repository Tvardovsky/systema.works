'use client';

import {useLocale, useTranslations} from 'next-intl';
import {Link, usePathname} from '@/i18n/navigation';
import {routing} from '@/i18n/routing';

const SHORT_LABELS: Record<(typeof routing.locales)[number], string> = {
  en: 'EN',
  'sr-ME': 'ME',
  ru: 'RU',
  uk: 'UA'
};

const FULL_LABELS: Record<(typeof routing.locales)[number], string> = {
  en: 'English',
  'sr-ME': 'Srpski (ME)',
  ru: 'Русский',
  uk: 'Українська'
};

export function LanguageSwitcher() {
  const t = useTranslations('Language');
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav className="lang" aria-label={t('label')}>
      {routing.locales.map((item) => (
        <Link
          key={item}
          href={pathname}
          locale={item}
          hrefLang={item}
          lang={item}
          title={FULL_LABELS[item]}
          aria-current={item === locale ? 'true' : undefined}
          className="lang-link"
        >
          {SHORT_LABELS[item]}
        </Link>
      ))}
    </nav>
  );
}
