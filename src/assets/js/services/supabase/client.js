import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config.js';

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Configura SUPABASE_URL y SUPABASE_ANON_KEY en src/assets/js/config.js.');
  }
}

assertSupabaseConfig();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
