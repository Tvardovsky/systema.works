import Image from 'next/image';
import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';
import {LanguageSwitcher} from '@/components/LanguageSwitcher';

type Props = {
  locale: string;
  withNav?: boolean;
};

export async function SiteHeader({locale, withNav = false}: Props) {
  const t = await getTranslations({locale, namespace: 'Landing'});

  return (
    <header className="site-header">
      <div className="wrap site-header-inner">
        <Link href="/" locale={locale as 'en'} className="brand" aria-label="SYSTEMA.WORKS">
          <Image src="/assets/systema-wordmark.svg" alt="" width={136} height={40} priority />
        </Link>

        {withNav ? (
          <nav className="site-nav" aria-label={t('navLabel')}>
            <a href="#services">{t('navServices')}</a>
            <a href="#case">{t('navCases')}</a>
            <a href="#process">{t('navProcess')}</a>
            <a href="#contact">{t('navContact')}</a>
          </nav>
        ) : null}

        <LanguageSwitcher />
      </div>
    </header>
  );
}
