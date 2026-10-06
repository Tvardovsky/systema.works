import type {Metadata, Viewport} from 'next';
import {NextIntlClientProvider, hasLocale} from 'next-intl';
import {getMessages, getTranslations, setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {Onest, JetBrains_Mono} from 'next/font/google';
import {routing, type AppLocale} from '@/i18n/routing';
import {SITE_NAME, SITE_URL, buildLocaleMetadata, buildOrganizationJsonLd} from '@/lib/seo';
import '../globals.css';

const onest = Onest({subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-sans', display: 'swap'});
const mono = JetBrains_Mono({subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-mono', display: 'swap'});

export const viewport: Viewport = {themeColor: '#f2eee5'};

type Props = {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({locale}));
}

export async function generateMetadata({params}: Pick<Props, 'params'>): Promise<Metadata> {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const appLocale = locale as AppLocale;
  const t = await getTranslations({locale: appLocale, namespace: 'Metadata'});
  return {
    ...buildLocaleMetadata(appLocale, t('title'), t('description')),
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    creator: SITE_NAME,
    publisher: SITE_NAME,
    robots: {index: true, follow: true}
  };
}

export default async function LocaleLayout({children, params}: Props) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const appLocale = locale as AppLocale;
  const t = await getTranslations({locale: appLocale, namespace: 'Metadata'});
  const jsonLd = buildOrganizationJsonLd(appLocale, t('description'));

  return (
    <html lang={appLocale} className={`${onest.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider locale={appLocale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}}
        />
      </body>
    </html>
  );
}
