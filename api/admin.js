import { createClient } from '@supabase/supabase-js';

// Server-only client — bypasses RLS with the service-role key. This is
// necessary because an admin writing to another user's wallets/investments/
// profiles row with the anon key gets silently blocked by RLS (0 rows
// affected, no error) rather than a visible failure.
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACTIONS = ['adjust_balance', 'assign_plan', 'remove_investment', 'delete_user', 'set_status'];

function genReference(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !caller) return res.status(401).json({ error: 'Invalid session' });

  const { data: callerProfile, error: profileErr } = await supabase
    .from('profiles').select('role').eq('id', caller.id).single();
  if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }

  const { action, userId } = req.body || {};
  if (!userId || !ACTIONS.includes(action)) {
    return res.status(400).json({ error: `Body must include userId and action: ${ACTIONS.join(' | ')}` });
  }

  try {
    if (action === 'adjust_balance') return await adjustBalance(req, res, userId);
    if (action === 'assign_plan') return await assignPlan(req, res, userId);
    if (action === 'remove_investment') return await removeInvestment(req, res, userId);
    if (action === 'set_status') return await setStatus(req, res, userId);
    if (action === 'delete_user') return await deleteUser(req, res, userId);
  } catch (err) {
    console.error('admin.js error:', err);
    return res.status(400).json({ error: err.message || 'Internal error' });
  }
}

async function adjustBalance(req, res, userId) {
  const { direction, amount } = req.body; // direction: 'add' | 'remove'
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!['add', 'remove'].includes(direction)) return res.status(400).json({ error: "direction must be 'add' or 'remove'" });

  const { data: wallet, error: wErr } = await supabase.from('wallets').select('available_balance').eq('user_id', userId).single();
  if (wErr || !wallet) throw new Error('Wallet not found for this user');

  const current = Number(wallet.available_balance || 0);
  if (direction === 'remove' && amt > current) {
    return res.status(400).json({ error: `Cannot remove ₦${amt.toLocaleString()} — wallet only has ₦${current.toLocaleString()}` });
  }
  const newBalance = direction === 'add' ? current + amt : current - amt;

  const { error: updErr } = await supabase.from('wallets').update({ available_balance: newBalance }).eq('user_id', userId);
  if (updErr) throw updErr;

  await supabase.from('transactions').insert([{
    user_id: userId,
    reference: genReference(direction === 'add' ? 'ADJ-CR' : 'ADJ-DR'),
    type: direction === 'add' ? 'admin_credit' : 'admin_debit',
    amount: amt,
    direction: direction === 'add' ? 'in' : 'out',
    status: 'completed',
    description: direction === 'add' ? 'Funds added by admin' : 'Funds removed by admin',
  }]);

  await supabase.from('notifications').insert([{
    user_id: userId,
    title: direction === 'add' ? 'Funds Added' : 'Funds Removed',
    message: direction === 'add'
      ? `₦${amt.toLocaleString()} was added to your wallet by an administrator.`
      : `₦${amt.toLocaleString()} was removed from your wallet by an administrator.`,
    is_read: false,
  }]);

  return res.status(200).json({ ok: true, newBalance });
}

async function assignPlan(req, res, userId) {
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'planId is required' });

  const { data: plan, error: planErr } = await supabase.from('investment_plans').select('*').eq('id', planId).single();
  if (planErr || !plan) return res.status(404).json({ error: 'Plan not found' });

  // Admin-granted plans do NOT debit the client's wallet — this is a manual
  // enrollment (bonus/compensation/promo), not a purchase. Use "Remove
  // Funds" separately if a debit is also intended.
  const { data: investment, error: invErr } = await supabase.from('investments').insert([{
    user_id: userId,
    plan_name: plan.name,
    principal_amount: plan.min_amount,
    daily_profit: plan.daily_profit,
    status: 'active',
  }]).select().single();
  if (invErr) throw invErr;

  await supabase.from('transactions').insert([{
    user_id: userId,
    reference: genReference('PLAN'),
    type: 'investment',
    amount: Number(plan.min_amount),
    direction: 'out',
    status: 'completed',
    description: `${plan.name} plan granted by admin`,
  }]);

  await supabase.from('notifications').insert([{
    user_id: userId,
    title: 'Plan Assigned',
    message: `An administrator enrolled you in the ${plan.name} plan.`,
    is_read: false,
  }]);

  return res.status(200).json({ ok: true, investment });
}

async function removeInvestment(req, res, userId) {
  const { investmentId } = req.body;
  if (!investmentId) return res.status(400).json({ error: 'investmentId is required' });

  const { data: inv, error: fetchErr } = await supabase.from('investments').select('*').eq('id', investmentId).eq('user_id', userId).single();
  if (fetchErr || !inv) return res.status(404).json({ error: 'Investment not found for this user' });

  const { error: delErr } = await supabase.from('investments').delete().eq('id', investmentId);
  if (delErr) throw delErr;

  await supabase.from('notifications').insert([{
    user_id: userId,
    title: 'Investment Removed',
    message: `Your ${inv.plan_name} investment was removed by an administrator.`,
    is_read: false,
  }]);

  return res.status(200).json({ ok: true });
}

async function setStatus(req, res, userId) {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'suspended'" });

  const { error } = await supabase.from('profiles').update({ status }).eq('id', userId);
  if (error) throw error;

  return res.status(200).json({ ok: true, status });
}

async function deleteUser(req, res, userId) {
  const tables = ['investments', 'deposits', 'withdrawals', 'transactions', 'notifications', 'wallets'];
  for (const table of tables) {
    await supabase.from(table).delete().eq('user_id', userId);
  }
  await supabase.from('profiles').delete().eq('id', userId);

  const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
  if (authErr) throw authErr;

  return res.status(200).json({ ok: true });
}
