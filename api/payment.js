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
      const FEE_PERCENT = 0.10;

      if (amount < MIN_WITHDRAWAL) throw new Error(`Minimum withdrawal is ₦${MIN_WITHDRAWAL}`);

      // 1. Authoritative balance check — balances live on `wallets`, not
      // `profiles` (profiles has no wallet_balance column at all, which is
      // why this previously errored and got misreported as "Profile not found").
      const { data: wallet, error: wError } = await supabase
        .from('wallets')
        .select('available_balance')
        .eq('user_id', user.id)
        .single();

      if (wError || !wallet) throw new Error("Wallet not found");
      if (wallet.available_balance < amount) throw new Error("Insufficient balance");

      // 2. Authoritative fee calculation
      const feeAmount = amount * FEE_PERCENT;
      const netAmount = amount - feeAmount;

      const reference = `WTH-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      // 3. Reserve the funds immediately (deduct the full requested amount,
      // not just the net) so the same balance can't be withdrawn twice
      // while this request sits pending. If admin rejects, the amount is
      // refunded back (handled in admin/withdrawals.html).
      const { error: deductErr } = await supabase
        .from('wallets')
        .update({ available_balance: wallet.available_balance - amount })
        .eq('user_id', user.id);
      if (deductErr) throw new Error('Could not reserve funds: ' + deductErr.message);

      const { error: insertErr } = await supabase.from('withdrawals').insert([{
        user_id: user.id,
        reference,
        amount,
        fee: feeAmount,
        net_amount: netAmount,
        status: 'pending',
        destination_details: payoutDetails || {}
      }]);
      if (insertErr) {
        // Roll back the reservation if the insert failed, so funds aren't
        // stuck deducted with no matching withdrawal record.
        await supabase.from('wallets').update({ available_balance: wallet.available_balance }).eq('user_id', user.id);
        throw new Error('Could not save withdrawal request: ' + insertErr.message);
      }

      return res.status(200).json({
        success: true,
        reference,
        fee: feeAmount,
        net: netAmount
      });
    }
    
    // Deposits are now a fully manual flow handled entirely client-side in
    // deposit.html (direct insert into `deposits` with status='pending',
    // confirmed later by an admin) — no gateway initialization needed here.
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
