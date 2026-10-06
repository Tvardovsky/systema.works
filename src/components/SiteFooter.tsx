import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';

export async function SiteFooter({locale}: {locale: string}) {
  const t = await getTranslations({locale, namespace: 'Landing'});

  return (
    <footer className="site-footer">
      <div className="wrap site-footer-inner">
        <span>{t('legal')}</span>
        <nav className="footer-links" aria-label="Legal">
          <Link href="/privacy" locale={locale as 'en'}>{t('privacy')}</Link>
          <Link href="/terms" locale={locale as 'en'}>{t('terms')}</Link>
        </nav>
      </div>
    </footer>
  );
}
