import {redirect} from 'next/navigation';
import {AdminLoginForm} from '@/components/AdminLoginForm';
import {getAdminRoleForUser} from '@/lib/repositories/omnichannel';
import {getSupabaseServerClient} from '@/lib/supabase/server';

type Props = {
  params: Promise<{locale: string}>;
};

export function generateStaticParams() {
  return [{locale: 'ru'}, {locale: 'en'}];
}

export default async function AdminLoginPage({params}: Props) {
  const {locale} = await params;
  if (locale !== 'ru' && locale !== 'en') {
    redirect('/ru/admin/login');
  }
  const adminLocale = locale as 'ru' | 'en';

  const supabase = await getSupabaseServerClient();
  const {data} = await supabase.auth.getUser();
  const userId = data.user?.id;

  if (userId) {
    const role = await getAdminRoleForUser(userId);
    if (role) {
      redirect(`/${adminLocale}/admin`);
    }
  }

  return (
    <main className="lp-main">
      <div className="page-shell admin-shell">
        <AdminLoginForm nextPath={`/${adminLocale}/admin`} locale={adminLocale} />
      </div>
    </main>
  );
}
