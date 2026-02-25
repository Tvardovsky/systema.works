import {type EmailOtpType} from '@supabase/supabase-js';
import {NextRequest, NextResponse} from 'next/server';
import {getSupabaseServerClient} from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const {searchParams, origin} = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/admin';
  const safeNext = next.startsWith('/') ? next : '/admin';
  const supabase = await getSupabaseServerClient();

  if (code) {
    const {error} = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  if (tokenHash && type) {
    const {error} = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
