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

      // Pull the live fee percentage and lock flag from admin_settings
      // instead of a hardcoded value, so admin changes take effect
      // immediately without a code deploy.
      const { data: settingsRows, error: settingsErr } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['withdrawal_fee', 'withdrawals_locked']);
      if (settingsErr) throw new Error('Could not load platform settings: ' + settingsErr.message);

      const settings = Object.fromEntries((settingsRows || []).map(r => [r.key, r.value]));
      const isLocked = settings.withdrawals_locked === true || settings.withdrawals_locked === 'true';
      if (isLocked) {
        throw new Error('Withdrawals are temporarily disabled by the administrator. Please try again later.');
      }

      const feePercentValue = Number(settings.withdrawal_fee);
      const FEE_PERCENT = (isFinite(feePercentValue) ? feePercentValue : 12) / 100;

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

      // Withdrawals require at least one active investment. This is the
      // authoritative check — the client-side lock on withdraw.html can be
      // bypassed via devtools, this cannot.
      const { data: activeInvestments, error: invErr } = await supabase
        .from('investments')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);
      if (invErr) throw new Error('Could not verify investment status: ' + invErr.message);
      if (!activeInvestments || activeInvestments.length === 0) {
        throw new Error('You need at least one active investment before you can withdraw.');
      }

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
