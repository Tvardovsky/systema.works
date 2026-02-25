import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';

export default async function AdminOutcomesRedirectPage() {
  const localeCookie = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale = localeCookie === 'en' ? 'en' : 'ru';
  redirect(`/${locale}/admin/outcomes`);
}
