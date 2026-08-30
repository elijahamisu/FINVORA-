import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Gift code is required' });
  }

  try {
    // Authoritative redemption happens entirely inside this
    // Postgres function (row-locked, atomic) — see
    // fix_gift_redemption.sql for the full validation logic
    // (active, not expired, under usage limit, not already
    // redeemed by this user).
    const { data, error } = await supabase.rpc('redeem_gift_code', {
      p_user_id: user.id,
      p_code: code
    });

    if (error) throw error;

    const rewardAmount = data && data[0] ? data[0].reward_amount : null;

    return res.status(200).json({ success: true, value: rewardAmount });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
