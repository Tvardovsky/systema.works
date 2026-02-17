import Image from 'next/image';
import {Button, Container} from '@radix-ui/themes';
import {GlobeIcon, MobileIcon, RocketIcon, GearIcon} from '@radix-ui/react-icons';
import {getTranslations} from 'next-intl/server';
import {LanguageSwitcher} from '@/components/LanguageSwitcher';
import {SocialLinks} from '@/components/SocialLinks';
import {ChatWidget} from '@/components/ChatWidget';
import {WebGLBackground} from '@/components/WebGLBackground';
import {MobileNav} from '@/components/MobileNav';
import {LottieLoader} from '@/components/LottieLoader';

type Props = {
  params: Promise<{locale: string}>;
};

export default async function HomePage({params}: Props) {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'Landing'});

  return (
    <>
      <WebGLBackground />
      <LottieLoader />
      <main data-locale={locale}>
        <Container size="4" maxWidth="1460px" className="page-shell">
        <header className="topbar reveal">
          <a className="brand" href="https://systema.works" aria-label="SYSTEMA.WORKS">
            <Image src="/assets/systema-wordmark.svg" alt="SYSTEMA logo" width={136} height={40} priority />
          </a>

          <nav className="top-nav" aria-label="Primary">
            <a href="#services">{t('navServices')}</a>
            <a href="#cases">{t('navCases')}</a>
            <a href="#process">{t('navProcess')}</a>
            <a href="#contact">{t('navContact')}</a>
          </nav>

          <div className="topbar-tools">
            <LanguageSwitcher />
            <MobileNav
              links={[
                {href: '#services', label: t('navServices')},
                {href: '#cases', label: t('navCases')},
                {href: '#process', label: t('navProcess')},
                {href: '#contact', label: t('navContact')}
              ]}
            />
          </div>
        </header>

        <section id="hero" className="hero">
          <div className="logo-wrap reveal">
            <dotlottie-wc src="/assets/systema-logo-animation.json" type="lottie" autoplay loop speed="1.5" />
          </div>

          <div className="hero-text reveal delay-1">
            <p className="eyebrow">{t('eyebrow')}</p>
            <h1>{t('title')}</h1>
            <p>{t('subtitle')}</p>

            <div className="hero-actions">
              <Button asChild radius="full" size="3" className="btn-primary">
                <a href="#ai-consultation">{t('ctaPrimary')}</a>
              </Button>
              <Button asChild radius="full" size="3" variant="surface" className="btn-secondary">
                <a href="#monte-guide">{t('ctaSecondary')}</a>
              </Button>
            </div>

            <p className="trust-line">{t('trust')}</p>
          </div>
        </section>

        <section className="kpi-grid reveal delay-2" aria-label="KPIs">
          <article><strong>{t('stat1Value')}</strong><span>{t('stat1')}</span></article>
          <article><strong>{t('stat2Value')}</strong><span>{t('stat2')}</span></article>
          <article><strong>{t('stat3Value')}</strong><span>{t('stat3')}</span></article>
        </section>

        <section id="services" className="section reveal delay-1">
          <div className="section-head">
            <h2>{t('servicesTitle')}</h2>
            <p>{t('servicesIntro')}</p>
          </div>

          <div className="card-grid">
            <article className="service-card">
              <div className="service-icon" aria-hidden><GlobeIcon className="service-icon-glyph" /></div>
              <h3>{t('service1Title')}</h3>
              <p>{t('service1Body')}</p>
            </article>
            <article className="service-card">
              <div className="service-icon" aria-hidden><GearIcon className="service-icon-glyph" /></div>
              <h3>{t('service2Title')}</h3>
              <p>{t('service2Body')}</p>
            </article>
            <article className="service-card">
              <div className="service-icon" aria-hidden><MobileIcon className="service-icon-glyph" /></div>
              <h3>{t('service3Title')}</h3>
              <p>{t('service3Body')}</p>
            </article>
            <article className="service-card">
              <div className="service-icon" aria-hidden><RocketIcon className="service-icon-glyph" /></div>
              <h3>{t('service4Title')}</h3>
              <p>{t('service4Body')}</p>
            </article>
          </div>
        </section>

        <section className="section split reveal delay-2">
          <div>
            <h2>{t('techTitle')}</h2>
            <p>{t('techBody')}</p>
          </div>

          <div className="tech-metrics">
            <div className="metric-row"><span>{t('metric1')}</span><i style={{width: '86%'}} /></div>
            <div className="metric-row"><span>{t('metric2')}</span><i style={{width: '78%'}} /></div>
            <div className="metric-row"><span>{t('metric3')}</span><i style={{width: '82%'}} /></div>
            <div className="metric-row"><span>{t('metric4')}</span><i style={{width: '74%'}} /></div>
          </div>
        </section>

        <section id="cases" className="section case-flagship reveal delay-1">
          <div className="case-bg-grid" aria-hidden="true" />
          <div className="case-flagship-grid">
            <div className="case-main">
              <p className="case-badge">{t('caseBadge')}</p>
              <h2>{t('caseTitle')}</h2>
              <p>{t('caseBody')}</p>
              <p className="case-narrative">{t('caseNarrative')}</p>

              <div className="hero-actions">
                <Button asChild radius="full" size="3" className="btn-primary">
                  <a href="https://monte.guide" target="_blank" rel="noopener noreferrer">{t('caseCtaPrimary')}</a>
                </Button>
                <Button asChild radius="full" size="3" variant="surface" className="btn-secondary">
                  <a href="#contact">{t('caseCtaSecondary')}</a>
                </Button>
              </div>
            </div>

            <aside className="case-side">
              <div className="case-points">
                <span>{t('caseOutcome1')}</span>
                <span>{t('caseOutcome2')}</span>
                <span>{t('caseOutcome3')}</span>
              </div>

              <div className="case-metrics">
                <article>
                  <strong>{t('caseMetric1Value')}</strong>
                  <span>{t('caseMetric1Label')}</span>
                </article>
                <article>
                  <strong>{t('caseMetric2Value')}</strong>
                  <span>{t('caseMetric2Label')}</span>
                </article>
                <article>
                  <strong>{t('caseMetric3Value')}</strong>
                  <span>{t('caseMetric3Label')}</span>
                </article>
              </div>
            </aside>
          </div>
        </section>

        <section id="monte-guide" className="section monte-showcase reveal delay-2">
          <div className="monte-layout">
            <div className="monte-preview">
              <p className="case-badge">{t('montePreviewBadge')}</p>
              <h2>{t('monteTitle')}</h2>
              <p>{t('monteIntro')}</p>
              <div className="monte-preview-tags">
                <span>{t('monteTag1')}</span>
                <span>{t('monteTag2')}</span>
                <span>{t('monteTag3')}</span>
              </div>
              <Button asChild radius="full" size="3" variant="surface" className="btn-secondary">
                <a href="https://monte.guide" target="_blank" rel="noopener noreferrer">{t('monteCta')}</a>
              </Button>
            </div>

            <div className="monte-grid">
              <article><span className="card-index">01</span><h3>{t('monteFeature1Title')}</h3><p>{t('monteFeature1Body')}</p></article>
              <article><span className="card-index">02</span><h3>{t('monteFeature2Title')}</h3><p>{t('monteFeature2Body')}</p></article>
              <article><span className="card-index">03</span><h3>{t('monteFeature3Title')}</h3><p>{t('monteFeature3Body')}</p></article>
              <article><span className="card-index">04</span><h3>{t('monteFeature4Title')}</h3><p>{t('monteFeature4Body')}</p></article>
              <article><span className="card-index">05</span><h3>{t('monteFeature5Title')}</h3><p>{t('monteFeature5Body')}</p></article>
              <article><span className="card-index">06</span><h3>{t('monteFeature6Title')}</h3><p>{t('monteFeature6Body')}</p></article>
            </div>
          </div>
        </section>

        <section id="process" className="section process-timeline reveal delay-2">
          <div className="section-head">
            <h2>{t('processTitle')}</h2>
            <p>{t('processIntro')}</p>
          </div>
          <ol className="timeline-modern">
            <li>
              <span className="timeline-dot">1</span>
              <h3>{t('step1Title')}</h3>
              <p>{t('step1Body')}</p>
              <small>{t('step1Outcome')}</small>
            </li>
            <li>
              <span className="timeline-dot">2</span>
              <h3>{t('step2Title')}</h3>
              <p>{t('step2Body')}</p>
              <small>{t('step2Outcome')}</small>
            </li>
            <li>
              <span className="timeline-dot">3</span>
              <h3>{t('step3Title')}</h3>
              <p>{t('step3Body')}</p>
              <small>{t('step3Outcome')}</small>
            </li>
            <li>
              <span className="timeline-dot">4</span>
              <h3>{t('step4Title')}</h3>
              <p>{t('step4Body')}</p>
              <small>{t('step4Outcome')}</small>
            </li>
          </ol>
        </section>

        <section className="section paired-section reveal delay-1">
          <article id="why-systema" className="paired-card">
            <h2>{t('whyTitle')}</h2>
            <p>{t('whyBody')}</p>
            <ul className="proof-cards">
              <li>
                <h3>{t('why1Title')}</h3>
                <p>{t('why1Body')}</p>
              </li>
              <li>
                <h3>{t('why2Title')}</h3>
                <p>{t('why2Body')}</p>
              </li>
              <li>
                <h3>{t('why3Title')}</h3>
                <p>{t('why3Body')}</p>
              </li>
            </ul>
          </article>

          <article id="ai-consultation" className="paired-card paired-card-accent">
            <h2>{t('aiTitle')}</h2>
            <p>{t('aiBody')}</p>
            <ul className="proof-cards compact">
              <li><p>{t('aiPoint1')}</p></li>
              <li><p>{t('aiPoint2')}</p></li>
              <li><p>{t('aiPoint3')}</p></li>
            </ul>
            <Button asChild radius="full" size="3" className="btn-primary">
              <a href="#contact">{t('aiCta')}</a>
            </Button>
          </article>
        </section>

        <section id="contact" className="section contact conversion-panel reveal delay-1">
          <div>
            <h2>{t('contactTitle')}</h2>
            <p>{t('contactBody')}</p>
            <p className="contact-trust">{t('contactTrust')}</p>
          </div>
          <div className="contact-actions">
            <SocialLinks />
          </div>
        </section>

        <footer id="legal" className="legal legal-compact reveal delay-2">
          <span>systema.works</span>
          <span>{t('legal')}</span>
        </footer>
        </Container>
      </main>
      <ChatWidget />
    </>
  );
}
