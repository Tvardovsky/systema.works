import {SITE_URL} from '@/lib/seo';

const content = `# SYSTEMA.WORKS

> Development studio: websites, web and mobile apps, business automation, AI integration and SMM.

## Website
- ${SITE_URL}

## Language versions
- ${SITE_URL}/en
- ${SITE_URL}/sr-ME
- ${SITE_URL}/ru
- ${SITE_URL}/uk

## Services
- Websites and landing pages
- Custom web applications and client portals
- Mobile apps for iOS and Android
- Business automation, AI assistants and integration of neural networks into business processes
- SMM automation

## Case
- monte.guide: service directory for Montenegro (web, Telegram bot with Mini App, PWA)

## Contact
- Telegram: https://t.me/systema_works_channel
- WhatsApp: https://wa.me/38268291324
- Instagram: https://www.instagram.com/systema.works
- Facebook: https://www.facebook.com/systemaworksagency
`;

export function GET() {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}
