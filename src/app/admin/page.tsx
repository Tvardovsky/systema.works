import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';

export default async function AdminPage() {
  const localeCookie = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale = localeCookie === 'en' ? 'en' : 'ru';
  redirect(`/${locale}/admin`);
}
