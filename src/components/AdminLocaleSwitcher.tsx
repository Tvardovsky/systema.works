'use client';

import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {twMerge} from 'tailwind-merge';

type Props = {
  locale: 'ru' | 'en';
  className?: string;
};

function buildAdminHref(pathname: string, searchParams: URLSearchParams, targetLocale: 'ru' | 'en'): string {
  const withoutLocale = pathname.replace(/^\/(ru|en)(?=\/|$)/, '');
  const normalizedPath = withoutLocale.startsWith('/') ? withoutLocale : `/${withoutLocale}`;
  const adminPath = normalizedPath === '/' ? '/admin' : normalizedPath;
  const query = searchParams.toString();
  return `/${targetLocale}${adminPath}${query ? `?${query}` : ''}`;
}

export function AdminLocaleSwitcher({locale, className}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className={twMerge('join', className)} role="group" aria-label="Admin language">
      {(['ru', 'en'] as const).map((item) => (
        <Link
          key={item}
          href={buildAdminHref(pathname, searchParams, item)}
          className={`btn btn-sm join-item ${locale === item ? 'btn-primary' : 'btn-ghost'}`}
          prefetch={false}
        >
          {item.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
