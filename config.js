// Supabase configuration for multi-tenant TimeClock
const SUPABASE_URL = 'https://bpljlflxkntyhyoekpkd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tWt_DKCU9VPXcyJ7rc_Rfg_teK7ovmW';

// Initialize Supabase client with passkey support
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { experimental: { passkey: true } }
});
