import type {Metadata} from 'next';
import {Theme} from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/cyrillic-500.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/cyrillic-700.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://systema.works'),
  title: 'SYSTEMA.WORKS',
  description: 'Web development, automation, AI implementation and SMM growth systems.',
  alternates: {
    canonical: '/'
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
