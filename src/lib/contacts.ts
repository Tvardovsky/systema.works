export type ContactChannel = {
  id: 'telegram' | 'whatsapp' | 'instagram' | 'facebook';
  name: string;
  handle: string;
  href: string;
};

export const CONTACT_CHANNELS: ContactChannel[] = [
  {id: 'telegram', name: 'Telegram', handle: '@systema_works_channel', href: 'https://t.me/systema_works_channel'},
  {id: 'whatsapp', name: 'WhatsApp', handle: '+382 68 291 324', href: 'https://wa.me/38268291324'},
  {id: 'instagram', name: 'Instagram', handle: '@systema.works', href: 'https://www.instagram.com/systema.works'},
  {id: 'facebook', name: 'Facebook', handle: 'systemaworksagency', href: 'https://www.facebook.com/systemaworksagency'}
];

export const MONTE_GUIDE_URL = 'https://monte.guide';
