import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseSecretKey, getSupabaseUrl} from '@/lib/supabase/env';

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (adminClient) {
    return adminClient;
  }

  adminClient = createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return adminClient;
}

