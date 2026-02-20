import Image from 'next/image';
import {GlobeIcon, MobileIcon, RocketIcon, GearIcon} from '@radix-ui/react-icons';
import {getTranslations} from 'next-intl/server';
import {LanguageSwitcher} from '@/components/LanguageSwitcher';
import {SocialLinks} from '@/components/SocialLinks';
import {ChatWidget} from '@/components/ChatWidget';
import {LandingNav} from '@/components/LandingNav';

type Props = {
  params: Promise<{locale: string}>;
};

export default async function HomePage({params}: Props) {
  const {locale} = await params;
  const t = await getTranslations({locale, namespace: 'Landing'});

  const services = [
    {title: t('service1Title'), icon: GlobeIcon},
    {title: t('service2Title'), icon: GearIcon},
    {title: t('service3Title'), icon: MobileIcon},
    {title: t('service4Title'), icon: RocketIcon}
  ];

  const process = [
    {title: t('step1Title'), outcome: t('step1Outcome')},
    {title: t('step2Title'), outcome: t('step2Outcome')},
    {title: t('step3Title'), outcome: t('step3Outcome')},
    {title: t('step4Title'), outcome: t('step4Outcome')}
  ];

  const navItems = [
    {href: '#services' as const, label: t('navServices'), desktopTestId: 'nav-services-desktop'},
    {href: '#cases' as const, label: t('navCases'), desktopTestId: 'nav-cases-desktop'},
    {href: '#process' as const, label: t('navProcess'), desktopTestId: 'nav-process-desktop'},
    {href: '#contact' as const, label: t('navContact'), desktopTestId: 'nav-contact-desktop'}
  ];

  return (
    <>
      <main data-locale={locale} data-theme="systema" className="lp-main">
        <div className="page-shell">
          <header
            className="navbar landing-navbar rounded-box px-3 py-2"
            data-testid="landing-navbar"
          >
            <div className="navbar-start min-w-0">
              <a className="brand" href="https://systema.works" aria-label="SYSTEMA.WORKS">
                <Image src="/assets/systema-wordmark.svg" alt="SYSTEMA logo" width={136} height={40} priority />
              </a>
            </div>

            <LandingNav items={navItems} />

            <div className="navbar-end gap-2">
              <LanguageSwitcher />
              <div className="dropdown dropdown-end lg:hidden">
                <button
                  tabIndex={0}
                  className="btn btn-ghost btn-circle"
                  aria-label="Open navigation"
                  data-testid="landing-mobile-nav-toggle"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="h-5 w-5 stroke-current">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <ul
                  tabIndex={0}
                  className="menu dropdown-content z-[70] mt-3 w-56 rounded-box border border-base-300 bg-base-100/95 p-2 shadow"
                  data-testid="landing-mobile-nav"
                >
                  <li><a data-testid="nav-services-mobile" href="#services">{t('navServices')}</a></li>
                  <li><a data-testid="nav-cases-mobile" href="#cases">{t('navCases')}</a></li>
                  <li><a data-testid="nav-process-mobile" href="#process">{t('navProcess')}</a></li>
                  <li><a data-testid="nav-contact-mobile" href="#contact">{t('navContact')}</a></li>
                </ul>
              </div>
            </div>
          </header>

          <section id="hero" className="landing-section reveal">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body gap-4 p-6 md:p-8">
                <span
                  className="badge badge-outline landing-badge w-fit px-3 text-[0.66rem] font-semibold uppercase tracking-[0.15em]"
                  data-testid="landing-badge-hero"
                >
                  {t('eyebrow')}
                </span>
                <h1 className="max-w-4xl text-balance text-[clamp(1.95rem,4.6vw,3.2rem)] font-black leading-[1.08] text-primary">
                  {t('title')}
                </h1>
                <p className="max-w-3xl text-pretty text-base leading-relaxed text-base-content/80">
                  {t('subtitle')}
                </p>

                <div className="card-actions gap-3 pt-1">
                  <button type="button" className="btn btn-primary rounded-full px-6" data-testid="cta-primary-hero" data-chat-open>
                    {t('ctaPrimary')}
                  </button>
                </div>

                <div className="stats stats-vertical rounded-2xl bg-base-200/65 md:stats-horizontal">
                  <div className="stat py-3">
                    <div className="stat-value text-[1.5rem] text-primary">{t('stat1Value')}</div>
                    <div className="stat-desc text-base-content/78">{t('stat1')}</div>
                  </div>
                  <div className="stat py-3">
                    <div className="stat-value text-[1.5rem] text-primary">{t('stat2Value')}</div>
                    <div className="stat-desc text-base-content/78">{t('stat2')}</div>
                  </div>
                  <div className="stat py-3">
                    <div className="stat-value text-[1.5rem] text-primary">{t('stat3Value')}</div>
                    <div className="stat-desc text-base-content/78">{t('stat3')}</div>
                  </div>
                </div>
              </div>
            </article>
          </section>

          <section id="services" className="landing-section reveal delay-1">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body gap-4 p-6 md:p-8">
                <div className="space-y-2">
                  <h2 className="text-2xl font-extrabold text-primary md:text-3xl">{t('servicesTitle')}</h2>
                  <p className="max-w-3xl text-base leading-relaxed text-base-content/78">{t('servicesIntro')}</p>
                </div>

                <ul className="space-y-3">
                  {services.map((service) => (
                    <li key={service.title} className="rounded-2xl bg-base-200/60 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                          <service.icon width="18" height="18" aria-hidden />
                        </span>
                        <p className="text-base font-semibold leading-tight text-base-content">{service.title}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </section>

          <section id="cases" className="landing-section reveal delay-1">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body gap-4 p-6 md:p-8">
                <span
                  className="badge badge-outline landing-badge w-fit text-[0.68rem] font-semibold uppercase tracking-[0.14em]"
                  data-testid="landing-badge-case"
                >
                  {t('caseBadge')}
                </span>
                <h2 className="text-2xl font-bold text-primary">{t('caseTitle')}</h2>
                <p className="max-w-3xl text-base leading-relaxed text-base-content/78">{t('caseBody')}</p>

                <div className="card-actions gap-3">
                  <a
                    className="btn btn-primary rounded-full px-6"
                    href="https://monte.guide"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="cta-primary-cases"
                  >
                    {t('caseCtaPrimary')}
                  </a>
                  <a className="btn btn-outline rounded-full px-6" href="#contact" data-testid="cta-secondary-cases">
                    {t('caseCtaSecondary')}
                  </a>
                </div>

                <div className="stats stats-vertical rounded-2xl bg-base-200/65 md:stats-horizontal">
                  <div className="stat py-3">
                    <div className="stat-value text-[1.45rem] text-primary">{t('caseMetric1Value')}</div>
                    <div className="stat-desc text-base-content/78">{t('caseMetric1Label')}</div>
                  </div>
                  <div className="stat py-3">
                    <div className="stat-value text-[1.45rem] text-primary">{t('caseMetric2Value')}</div>
                    <div className="stat-desc text-base-content/78">{t('caseMetric2Label')}</div>
                  </div>
                  <div className="stat py-3">
                    <div className="stat-value text-[1.45rem] text-primary">{t('caseMetric3Value')}</div>
                    <div className="stat-desc text-base-content/78">{t('caseMetric3Label')}</div>
                  </div>
                </div>
              </div>
            </article>
          </section>

          <section id="process" className="landing-section reveal delay-2">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body gap-4 p-6 md:p-8">
                <h2 className="text-2xl font-bold text-primary">{t('processTitle')}</h2>
                <p className="max-w-3xl text-base leading-relaxed text-base-content/78">{t('processIntro')}</p>

                <ul className="join join-vertical w-full">
                  {process.map((step, index) => (
                    <li key={step.title} className="join-item rounded-2xl bg-base-200/60 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-content">
                          {index + 1}
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold text-primary">{step.title}</h3>
                          <p className="text-sm leading-relaxed text-base-content/76">{step.outcome}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </section>

          <section id="ai-consultation" className="landing-section reveal delay-2">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body gap-4 p-6 md:p-8">
                <div className="flex items-center gap-3">
                  <Image src="/assets/systema-mark.svg" alt="Systema mark" width={52} height={52} />
                  <span
                    className="badge badge-outline landing-badge text-[0.68rem] font-semibold uppercase tracking-[0.14em]"
                    data-testid="landing-badge-ai"
                  >
                    AI sales-manager roadmap
                  </span>
                </div>

                <h2 className="text-2xl font-bold text-primary">{t('aiTitle')}</h2>
                <p className="max-w-3xl text-base leading-relaxed text-base-content/78">{t('aiBody')}</p>

                <div className="rounded-2xl bg-base-200/65 p-4">
                  <div className="ai-chat-preview">
                    <div className="ai-chat-row ai-chat-row-user">
                      <p className="ai-chat-bubble ai-chat-bubble-user">Need a landing + chatbot handoff in 2 weeks.</p>
                    </div>
                    <div className="ai-chat-row ai-chat-row-assistant">
                      <p className="ai-chat-bubble ai-chat-bubble-assistant">Got it. I will qualify scope, budget, timeline, and route your brief to manager.</p>
                    </div>
                  </div>
                </div>

                <ul className="menu rounded-2xl bg-base-200/65 p-2">
                  <li><span>{t('aiPoint1')}</span></li>
                  <li><span>{t('aiPoint2')}</span></li>
                  <li><span>{t('aiPoint3')}</span></li>
                </ul>

                <div className="card-actions">
                  <button type="button" className="btn btn-primary rounded-full px-6" data-testid="cta-primary-ai" data-chat-open>
                    {t('aiCta')}
                  </button>
                </div>
              </div>
            </article>
          </section>

          <section id="contact" className="landing-section reveal delay-1">
            <article className="card contact-card bg-base-100 shadow-sm">
              <div className="card-body contact-card-body gap-4 p-6 md:p-8">
                <h2 className="text-2xl font-bold text-primary">{t('contactTitle')}</h2>
                <p className="max-w-3xl text-base leading-relaxed text-base-content/78">{t('contactBody')}</p>
                <p className="contact-trust">{t('contactTrust')}</p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <SocialLinks />
                  <button type="button" className="btn btn-outline rounded-full px-6" data-chat-open>{t('aiCta')}</button>
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
