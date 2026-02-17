import type {Metadata} from 'next';
import {type AppLocale} from '@/i18n/routing';

export const SITE_URL = 'https://systema.works';
export const SITE_NAME = 'SYSTEMA.WORKS';

export const LOCALE_PATHS: Record<AppLocale, string> = {
  en: '/en',
  'sr-ME': '/sr-ME',
  ru: '/ru',
  uk: '/uk'
};

const OG_LOCALE: Record<AppLocale, string> = {
  en: 'en_US',
  'sr-ME': 'sr_ME',
  ru: 'ru_RU',
  uk: 'uk_UA'
};

const KEYWORDS: Record<AppLocale, string[]> = {
  en: [
    'web development agency',
    'web application development',
    'mobile app development',
    'iOS app development',
    'Android app development',
    'business automation',
    'AI implementation',
    'AI chatbot development',
    'SMM automation',
    'lead generation automation',
    'multilingual website development',
    'Montenegro digital agency',
    'systema works',
    'systema.works',
    'monte.guide'
  ],
  'sr-ME': [
    'agencija za izradu sajtova',
    'razvoj web aplikacija',
    'razvoj mobilnih aplikacija',
    'iOS i Android razvoj',
    'automatizacija poslovanja',
    'AI implementacija',
    'AI chatbot za prodaju',
    'SMM automatizacija',
    'digitalna agencija Crna Gora',
    'višejezični sajt',
    'systema works',
    'systema.works',
    'monte.guide'
  ],
  ru: [
    'агентство веб разработки',
    'разработка веб приложений',
    'разработка мобильных приложений',
    'разработка iOS и Android',
    'автоматизация бизнеса',
    'внедрение AI',
    'AI чат бот для продаж',
    'автоматизация SMM',
    'лидогенерация',
    'цифровое агентство Черногория',
    'мультиязычный сайт',
    'systema works',
    'systema.works',
    'monte.guide'
  ],
  uk: [
    'агенція веб розробки',
    'розробка веб застосунків',
    'розробка мобільних застосунків',
    'розробка iOS і Android',
    'автоматизація бізнесу',
    'впровадження AI',
    'AI чат бот для продажів',
    'автоматизація SMM',
    'лідогенерація',
    'цифрова агенція Чорногорія',
    'багатомовний сайт',
    'systema works',
    'systema.works',
    'monte.guide'
  ]
};

export function getLocaleUrl(locale: AppLocale): string {
  return `${SITE_URL}${LOCALE_PATHS[locale]}`;
}

export function getLanguageAlternates(): Record<AppLocale, string> {
  return {
    en: getLocaleUrl('en'),
    'sr-ME': getLocaleUrl('sr-ME'),
    ru: getLocaleUrl('ru'),
    uk: getLocaleUrl('uk')
  };
}

export function buildLocaleMetadata(locale: AppLocale, title: string, description: string): Metadata {
  const canonical = getLocaleUrl(locale);
  const ogImage = `${SITE_URL}/assets/systema-wordmark.png`;

  return {
    title,
    description,
    keywords: KEYWORDS[locale],
    alternates: {
      canonical,
      languages: getLanguageAlternates()
    },
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description,
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: 'SYSTEMA.WORKS'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage]
    },
    category: 'technology'
  };
}

export function buildOrganizationJsonLd(locale: AppLocale, description: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/assets/systema-mark.svg`,
        sameAs: [
          'https://www.facebook.com/systemaworksagency',
          'https://www.instagram.com/systema.works',
          'https://t.me/systema_works_channel',
          'https://wa.me/38268291324'
        ]
      },
      {
        '@type': 'ProfessionalService',
        '@id': `${getLocaleUrl(locale)}#service`,
        name: SITE_NAME,
        url: getLocaleUrl(locale),
        description,
        areaServed: ['Montenegro', 'Europe', 'Remote'],
        knowsLanguage: ['en', 'sr-ME', 'ru', 'uk'],
        serviceType: [
          'Web development',
          'Web application development',
          'Mobile app development',
          'Business automation',
          'AI implementation',
          'SMM automation'
        ]
      }
    ]
  };
}
