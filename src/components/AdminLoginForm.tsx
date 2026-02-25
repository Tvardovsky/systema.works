'use client';

import {FormEvent, useState} from 'react';
import {useTranslations} from 'next-intl';
import {getSupabaseBrowserClient} from '@/lib/supabase/browser';
import {AdminLocaleSwitcher} from '@/components/AdminLocaleSwitcher';

type Props = {
  nextPath: string;
  locale: 'ru' | 'en';
};

export function AdminLoginForm({nextPath, locale}: Props) {
  const t = useTranslations('Admin');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{error: string | null; message: string | null}>({error: null, message: null});
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setStatus({error: t('errors.emailRequired'), message: null});
      return;
    }

    setLoading(true);
    setStatus({error: null, message: null});

    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const {error} = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false
        }
      });

      if (error) {
        setStatus({error: error.message, message: null});
      } else {
        setStatus({error: null, message: t('login.magicSent')});
      }
    } catch (error) {
      setStatus({error: error instanceof Error ? error.message : t('errors.signInFailed'), message: null});
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card bg-base-100 shadow-sm" onSubmit={onSubmit} suppressHydrationWarning>
      <div className="card-body gap-4 p-6">
        <div className="admin-login-head">
          <div>
            <h1 className="text-2xl font-black text-primary">{t('login.title')}</h1>
            <p className="text-sm text-base-content/70">{t('login.subtitle')}</p>
          </div>
          <AdminLocaleSwitcher locale={locale} />
        </div>
        <label className="form-control gap-2">
          <span className="label-text">{t('fields.email')}</span>
          <input
            className="input input-bordered"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@company.com"
            suppressHydrationWarning
          />
        </label>

        {status.error ? <p className="text-sm text-error">{status.error}</p> : null}
        {status.message ? <p className="text-sm text-success">{status.message}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={loading} suppressHydrationWarning>
          {loading ? t('login.sending') : t('login.sendLink')}
        </button>
      </div>
    </form>
  );
}
