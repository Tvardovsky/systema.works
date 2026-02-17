'use client';

import {Select} from '@radix-ui/themes';
import {useLocale, useTranslations} from 'next-intl';
import {usePathname, useRouter} from '@/i18n/navigation';
import {routing} from '@/i18n/routing';

const localeLabels: Record<(typeof routing.locales)[number], string> = {
  en: 'English',
  'sr-ME': 'Srpski (ME)',
  ru: 'Русский',
  uk: 'Українська'
};

export function LanguageSwitcher() {
  const t = useTranslations('Language');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = locale as (typeof routing.locales)[number];

  const onSelect = (nextLocale: (typeof routing.locales)[number]) => {
    if (nextLocale === currentLocale) {
      return;
    }
    router.replace(pathname, {locale: nextLocale});
  };

  return (
    <div className="language-switcher" aria-label={t('label')}>
      <span className="language-switcher-label">{t('label')}</span>
      <Select.Root value={currentLocale} onValueChange={(nextLocale) => onSelect(nextLocale as (typeof routing.locales)[number])}>
        <Select.Trigger
          className="language-switcher-trigger"
          radius="full"
          variant="surface"
          color="gray"
          aria-label={t('label')}
        />
        <Select.Content className="language-switcher-menu" align="end" position="popper">
          {routing.locales.map((item) => (
            <Select.Item key={item} value={item} className="language-switcher-item">
              {localeLabels[item]}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </div>
  );
}
