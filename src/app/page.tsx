import {headers} from 'next/headers';
import {redirect} from 'next/navigation';

type SupportedLocale = 'en' | 'sr-ME' | 'ru' | 'uk';

function resolveLocale(acceptLanguage: string | null): SupportedLocale {
  if (!acceptLanguage) {
    return 'en';
  }

  const normalized = acceptLanguage.toLowerCase();

  if (normalized.includes('sr-me') || normalized.includes('sr-rs') || normalized.includes('sr')) {
    return 'sr-ME';
  }

  if (normalized.includes('ru')) {
    return 'ru';
  }

  if (normalized.includes('uk') || normalized.includes('ua')) {
    return 'uk';
  }

  return 'en';
}

export default async function RootPage() {
  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  redirect(`/${locale}`);
}
