import {getTranslations, setRequestLocale} from 'next-intl/server';
import {SiteHeader} from '@/components/SiteHeader';
import {SiteFooter} from '@/components/SiteFooter';
import {ArrowIcon, ChannelIcon} from '@/components/Icons';
import {CONTACT_CHANNELS, MONTE_GUIDE_URL} from '@/lib/contacts';

type Props = {
  params: Promise<{locale: string}>;
};

export default async function HomePage({params}: Props) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations({locale, namespace: 'Landing'});

  const facts = [1, 2, 3].map((n) => ({value: t(`fact${n}Value`), label: t(`fact${n}Label`)}));
  const services = [1, 2, 3, 4].map((n) => ({title: t(`service${n}Title`), body: t(`service${n}Body`)}));
  const metrics = [1, 2, 3].map((n) => ({value: t(`caseM${n}Value`), label: t(`caseM${n}Label`)}));
  const steps = [1, 2, 3, 4].map((n) => ({title: t(`step${n}Title`), body: t(`step${n}Body`)}));

  return (
    <>
      <a className="skip-link" href="#main">{t('skip')}</a>
      <SiteHeader locale={locale} withNav />

      <main id="main">
        <section className="hero wrap" aria-labelledby="hero-title">
          <p className="eyebrow rise" style={{'--i': 0} as React.CSSProperties}>{t('heroEyebrow')}</p>
          <h1 id="hero-title" className="hero-title rise" style={{'--i': 1} as React.CSSProperties}>{t('heroTitle')}</h1>
          <div className="hero-lower rise" style={{'--i': 2} as React.CSSProperties}>
            <p className="hero-sub">{t('heroSubtitle')}</p>
            <div className="hero-actions">
              <a className="btn btn-solid" href="#contact">{t('ctaContact')}</a>
              <a className="btn btn-line" href="#case">{t('ctaCase')}</a>
            </div>
          </div>
          <dl className="facts rise" style={{'--i': 3} as React.CSSProperties}>
            {facts.map((fact) => (
              <div key={fact.value} className="fact">
                <dt>{fact.value}</dt>
                <dd>{fact.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="services" className="block wrap" aria-labelledby="services-title">
          <header className="block-head">
            <p className="label">01</p>
            <div>
              <h2 id="services-title">{t('servicesTitle')}</h2>
              <p className="intro">{t('servicesIntro')}</p>
            </div>
          </header>
          <ul className="rows">
            {services.map((service, index) => (
              <li key={service.title} className="row">
                <span className="row-num">{String(index + 1).padStart(2, '0')}</span>
                <h3>{service.title}</h3>
                <p>{service.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="case" className="case" aria-labelledby="case-title">
          <div className="wrap case-inner">
            <p className="label">02 · {t('caseBadge')}</p>
            <h2 id="case-title">{t('caseTitle')}</h2>
            <p className="case-body">{t('caseBody')}</p>
            <a className="btn btn-paper" href={MONTE_GUIDE_URL} target="_blank" rel="noopener noreferrer">
              {t('caseCta')}
              <ArrowIcon />
            </a>
            <dl className="metrics">
              {metrics.map((metric) => (
                <div key={metric.value} className="metric">
                  <dt>{metric.value}</dt>
                  <dd>{metric.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="process" className="block wrap" aria-labelledby="process-title">
          <header className="block-head">
            <p className="label">03</p>
            <div>
              <h2 id="process-title">{t('processTitle')}</h2>
              <p className="intro">{t('processIntro')}</p>
            </div>
          </header>
          <ol className="steps">
            {steps.map((step, index) => (
              <li key={step.title} className="step">
                <span className="step-num">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="contact" className="block wrap contact" aria-labelledby="contact-title">
          <header className="block-head">
            <p className="label">04</p>
            <div>
              <h2 id="contact-title">{t('contactTitle')}</h2>
              <p className="intro">{t('contactBody')}</p>
            </div>
          </header>
          <ul className="channels" aria-label={t('contactLabel')}>
            {CONTACT_CHANNELS.map((channel) => (
              <li key={channel.id}>
                <a href={channel.href} target="_blank" rel="noopener noreferrer" className="channel">
                  <ChannelIcon id={channel.id} />
                  <span className="channel-name">{channel.name}</span>
                  <span className="channel-handle">{channel.handle}</span>
                  <ArrowIcon />
                </a>
              </li>
            ))}
          </ul>
          <p className="contact-note">{t('contactNote')}</p>
        </section>
      </main>

      <SiteFooter locale={locale} />
    </>
  );
}
