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

  const { action, amount, payoutDetails } = req.body;

  try {
    if (action === 'withdraw') {
      const MIN_WITHDRAWAL = 650;
      const FEE_PERCENT = 0.07;

      if (amount < MIN_WITHDRAWAL) throw new Error(`Minimum withdrawal is ₦${MIN_WITHDRAWAL}`);

      // 1. Authoritative balance check
      const { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single();

      if (pError || !profile) throw new Error("Profile not found");
      if (profile.wallet_balance < amount) throw new Error("Insufficient balance");

      // 2. Authoritative fee calculation
      const feeAmount = amount * FEE_PERCENT;
      const netAmount = amount - feeAmount;

      // 3. Atomic Transaction (handled via RPC in SQL step)
      // For now, we return the calculated values for the UI to handle the next state
      return res.status(200).json({
        success: true,
        reference: `WTH-${Date.now()}`,
        fee: feeAmount,
        net: netAmount
      });
    }
    
    // Existing deposit logic...
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
