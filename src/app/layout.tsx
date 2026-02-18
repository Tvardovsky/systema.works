import type {Metadata} from 'next';
import {Inter} from 'next/font/google';
import {Theme} from '@radix-ui/themes';
import {SITE_NAME, SITE_URL} from '@/lib/seo';
import '@radix-ui/themes/styles.css';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  variable: '--font-systema'
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: SITE_NAME,
  description: 'Web, mobile, automation and AI implementation agency with multilingual delivery.',
  keywords: [
    'web development',
    'web applications',
    'mobile app development',
    'automation',
    'ai implementation',
    'smm'
  ],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  authors: [{name: SITE_NAME}],
  alternates: {
    canonical: '/en'
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className={inter.className}>
        <Theme
          className="systema-theme"
          appearance="light"
          accentColor="blue"
          grayColor="slate"
          panelBackground="translucent"
          radius="large"
          scaling="100%"
        >
          {children}
        </Theme>
      </body>
    </html>
  );
}
