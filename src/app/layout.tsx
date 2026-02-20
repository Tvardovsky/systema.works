import type {Metadata} from 'next';
import {Theme} from '@radix-ui/themes';
import {SITE_NAME, SITE_URL} from '@/lib/seo';
import '@radix-ui/themes/styles.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-700.css';
import './globals.css';

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
    <html lang="en" suppressHydrationWarning>
      <body>
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
