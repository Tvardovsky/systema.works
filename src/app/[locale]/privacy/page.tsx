import {getTranslations} from 'next-intl/server';
import {LanguageSwitcher} from '@/components/LanguageSwitcher';
import {ChatWidget} from '@/components/ChatWidget';
import Image from 'next/image';

type Props = {
  params: Promise<{locale: string}>;
};

export default async function PrivacyPage({params}: Props) {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'Landing'});
  const tp = await getTranslations({locale, namespace: 'Privacy'});

  const sections = [
    'dataCollection',
    'dataUsage',
    'dataStorage',
    'dataSharing',
    'security',
    'yourRights',
    'cookies',
    'contact'
  ] as const;

  return (
    <>
      <main data-locale={locale} data-theme="systema" className="lp-main">
        <div className="page-shell">
          <header
            className="navbar landing-navbar rounded-box px-3 py-2"
            data-testid="landing-navbar"
          >
            <div className="navbar-start min-w-0">
              <a className="brand" href={`/${locale}`} aria-label="SYSTEMA.WORKS">
                <Image src="/assets/systema-wordmark.svg" alt="SYSTEMA logo" width={136} height={40} priority />
              </a>
            </div>

            <div className="navbar-end gap-2">
              <a href={`/${locale}/#contact`} className="btn btn-primary btn-sm rounded-full" data-testid="nav-contact-from-privacy">
                {t('ctaPrimary')}
              </a>
              <LanguageSwitcher />
            </div>
          </header>

          <section className="reveal">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body gap-6 p-6 md:p-8">
                <div className="space-y-4">
                  <h1 className="text-3xl font-black text-primary">{tp('title')}</h1>
                  <p className="text-sm text-base-content/60">{tp('lastUpdated')}</p>
                  <p className="max-w-3xl text-base leading-relaxed text-base-content/80">{tp('intro')}</p>
                </div>

                <div className="divider" />

                <div className="space-y-8">
                  {sections.map((sectionKey) => {
                    const section = tp.raw(`sections.${sectionKey}`) as any;
                    return (
                      <div key={sectionKey} className="space-y-3">
                        <h2 className="text-xl font-bold text-primary">{section.title}</h2>
                        <p className="text-base leading-relaxed text-base-content/80">{section.content}</p>
                        {section.items && (
                          <ul className="mt-3 space-y-2">
                            {section.items.map((item: string, index: number) => (
                              <li key={index} className="flex items-start gap-2">
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                                <span className="text-base leading-relaxed text-base-content/80">{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="card-actions pt-4">
                  <a href={`/${locale}/#contact`} className="btn btn-primary rounded-full px-6" data-testid="cta-contact-from-privacy">
                    {t('ctaPrimary')}
                  </a>
                </div>
              </div>
            </article>
          </section>

          <footer id="legal" className="legal legal-compact reveal delay-2">
            <span>systema.works</span>
            <span>{t('legal')}</span>
          </footer>
        </div>
      </main>

      <ChatWidget />
    </>
  );
}
