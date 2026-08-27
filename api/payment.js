import { createClient } from '@supabase/supabase-js';

// Sensitive keys are handled server-side via process.env
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Verify Authentication
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { amount, action } = req.body;

  try {
    // Action: Initialize Deposit
    if (action === 'initialize') {
      const minDeposit = 2800;
      if (!amount || amount < minDeposit) throw new Error(`Minimum deposit is ₦${minDeposit}`);

      // Create unique deposit reference
      const reference = `FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Create pending record in DB
      const { data, error: dbError } = await supabase
        .from('deposits')
        .insert([{
          user_id: user.id,
          amount: amount,
          reference: reference,
          status: 'pending',
          method: 'gateway'
        }])
        .select()
        .single();

      if (dbError) throw dbError;

      // Return initialization data (In production, this includes gateway checkout link)
      return res.status(200).json({
        success: true,
        reference: reference,
        amount: amount,
        checkout_url: '#' // This would be the Paystack/Flutterwave link
      });
    }

    throw new Error('Invalid action');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
