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
      const minWithdrawal = 650;
      const feePercent = 0.07; // 7%

      // 1. Authoritative Balance & Settings check
      const { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', user.id)
        .single();

      if (pError || !profile) throw new Error("User profile not found");
      if (amount < minWithdrawal) throw new Error(`Minimum withdrawal is ₦${minWithdrawal}`);
      if (profile.wallet_balance < amount) throw new Error("Insufficient available balance");

      // 2. Authoritative Calculations
      const feeAmount = amount * feePercent;
      const netAmount = amount - feeAmount;
      const reference = `WTH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 3. Atomic Database Transaction (via RPC)
      // This RPC will: 
      // - Deduct amount from wallet_balance
      // - Create a 'pending' withdrawal record
      // - Create a transaction log
      const { data, error: txError } = await supabase.rpc('process_withdrawal_request', {
        p_user_id: user.id,
        p_amount: amount,
        p_fee: feeAmount,
        p_net: netAmount,
        p_ref: reference,
        p_bank_info: payoutDetails
      });

      if (txError) throw txError;

      return res.status(200).json({ success: true, reference, netAmount });
    }

    throw new Error('Invalid action');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
