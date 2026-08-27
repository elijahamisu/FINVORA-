import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Secure server-side key
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Authenticate Requesting User
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { action, amount, reference } = req.body;

  try {
    // Action: Initialize Payment
    if (action === 'initialize') {
      const minDeposit = 2800; // Authoritative minimum
      if (!amount || amount < minDeposit) throw new Error(`Minimum deposit is ₦${minDeposit}`);

      // Generate a unique reference for the gateway
      const paymentRef = `FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Create a pending deposit record
      const { error: dbError } = await supabase
        .from('deposits')
        .insert([{
          user_id: user.id,
          amount: amount,
          reference: paymentRef,
          status: 'pending',
          method: 'gateway'
        }]);

      if (dbError) throw dbError;

      // In a real integration, here you would call Paystack/Flutterwave API 
      // and return the actual authorization_url.
      return res.status(200).json({ 
        success: true, 
        reference: paymentRef,
        message: 'Payment initialized' 
      });
    }

    // Action: Verify Payment (Triggered by Webhook or Callback)
    if (action === 'verify') {
      // Logic for verifying gateway status and atomicity crediting wallet
      // This will use a Supabase RPC call to update balance + transaction record
      throw new Error("Verification requires gateway configuration");
    }

  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
