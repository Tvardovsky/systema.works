import {createServerClient, type CookieOptions} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {getSupabasePublishableKey, getSupabaseUrl} from '@/lib/supabase/env';

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({name, value, options}: {name: string; value: string; options?: CookieOptions}) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignored in places where cookie writes are not supported.
        }
      }
    }
  });
}

