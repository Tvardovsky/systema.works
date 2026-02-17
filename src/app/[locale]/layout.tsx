import type {Metadata} from 'next';
import {NextIntlClientProvider, hasLocale} from 'next-intl';
import {getMessages, getTranslations, setRequestLocale} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing, type AppLocale} from '@/i18n/routing';
import {buildLocaleMetadata, buildOrganizationJsonLd} from '@/lib/seo';

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
  return buildLocaleMetadata(appLocale, t('title'), t('description'));
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
    <>
      <NextIntlClientProvider locale={appLocale} messages={messages}>
        <div lang={appLocale}>{children}</div>
      </NextIntlClientProvider>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}}
      />
    </>
  );
}
