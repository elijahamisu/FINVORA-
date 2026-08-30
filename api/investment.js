import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Server-side only
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Authenticate User
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { planName } = req.body;

  try {
    // 2. Authoritative Plan Lookup (Server-side)
    // Matched by name, not id: the frontend's plan selector uses
    // local display-only IDs (e.g. "VIP1") that don't correspond
    // to the database's real uuid primary keys. Also note the
    // actual column is `status` (text), not `active` (boolean).
    const { data: plan, error: planError } = await supabase
      .from('investment_plans')
      .select('*')
      .eq('name', planName)
      .eq('status', 'active')
      .single();

    if (planError || !plan) throw new Error('Invalid or inactive plan');

    // 3. Atomic Transaction via RPC
    // This executes a stored procedure that checks balance, deducts it, 
    // creates the investment, and logs the transaction in one go.
    const { data, error: txError } = await supabase.rpc('create_investment_secure', {
      p_user_id: user.id,
      p_plan_id: plan.id,
      p_amount: plan.min_investment
    });

    if (txError) throw new Error(txError.message);

    return res.status(200).json({ success: true, data });

  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
