import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// If these env vars are missing/wrong, createClient() throws immediately,
// which silently kills every page's entire inline <script type="module">
// before it can attach any button/form handlers — producing exactly the
// "nothing happens, page just reloads" symptom with no visible error.
// This makes that failure visible on-screen instead of only in devtools.
function showFatalConfigError(message) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;padding:14px 18px;font-family:monospace;font-size:13px;line-height:1.5;';
  banner.textContent = '⚠ FINVORA config error: ' + message;
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(banner));
  if (document.body) document.body.prepend(banner);
}

let supabaseInstance;

if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  showFatalConfigError(`Missing environment variable(s): ${missing.join(', ')}. These must be set in Vercel → Project → Settings → Environment Variables, then the project must be redeployed.`);
  // Stub client so the rest of the page's JS doesn't crash on import —
  // every call just rejects with a clear message instead.
  const stubError = () => Promise.resolve({ data: null, error: new Error(`Supabase not configured — missing ${missing.join(', ')}`) });
  supabaseInstance = {
    auth: {
      signUp: stubError, signInWithPassword: stubError, getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }), signOut: stubError,
    },
    from: () => ({ select: stubError, insert: stubError, update: stubError, delete: stubError, eq: function(){return this;}, single: stubError }),
  };
} else {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  } catch (err) {
    showFatalConfigError(`createClient() threw: ${err.message}`);
    throw err;
  }
}

export const supabase = supabaseInstance;
