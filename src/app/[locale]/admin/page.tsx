import {redirect} from 'next/navigation';
import {AdminDashboard} from '@/components/AdminDashboard';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {getAdminRoleForUser} from '@/lib/repositories/omnichannel';

type Props = {
  params: Promise<{locale: string}>;
};

export function generateStaticParams() {
  return [{locale: 'ru'}, {locale: 'en'}];
}

export default async function AdminPage({params}: Props) {
  const {locale} = await params;
  if (locale !== 'ru' && locale !== 'en') {
    redirect('/ru/admin');
  }
  const adminLocale = locale as 'ru' | 'en';

  const supabase = await getSupabaseServerClient();
  const {data} = await supabase.auth.getUser();
  const userId = data.user?.id;

  if (!userId) {
    redirect(`/${adminLocale}/admin/login`);
  }

  const role = await getAdminRoleForUser(userId);
  if (!role) {
    redirect(`/${adminLocale}/admin/login?error=unauthorized`);
  }

  return <AdminDashboard locale={adminLocale} role={role} />;
}
