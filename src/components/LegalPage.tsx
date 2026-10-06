import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';
import {SiteHeader} from '@/components/SiteHeader';
import {SiteFooter} from '@/components/SiteFooter';

type Section = {title: string; content: string; items?: string[]};

type Props = {
  locale: string;
  namespace: 'Privacy' | 'Terms';
  sections: readonly string[];
};

export async function LegalPage({locale, namespace, sections}: Props) {
  const t = await getTranslations({locale, namespace});
  const tl = await getTranslations({locale, namespace: 'Landing'});

  return (
    <>
      <SiteHeader locale={locale} />
      <main id="main" className="legal-page">
        <div className="wrap legal-grid">
          <aside className="legal-aside">
            <Link href="/" locale={locale as 'en'} className="back-link">← {tl('back')}</Link>
          </aside>
          <article className="legal-body">
            <h1>{t('title')}</h1>
            <p className="meta">{t('lastUpdated')}</p>
            <p className="lead">{t('intro')}</p>
            {sections.map((key) => {
              const section = t.raw(`sections.${key}`) as Section;
              return (
                <section key={key}>
                  <h2>{section.title}</h2>
                  <p>{section.content}</p>
                  {section.items ? (
                    <ul>
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </article>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
