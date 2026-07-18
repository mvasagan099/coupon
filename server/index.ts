import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Middleware for API Key Authentication
const authenticateAPIKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

app.use(authenticateAPIKey);

// GET /api/v1/coupons/:code
app.post('/api/v1/coupons/verify', async (req, res) => {
  try {
    const { couponCode, userId, gameId } = req.body;
    
    if (!couponCode) {
      return res.status(400).json({ success: false, code: 'INVALID_COUPON', message: 'Coupon code is required.' });
    }

    const { data: coupons, error } = await supabase
      .rpc('verify_game_coupon', { p_code: couponCode.toUpperCase() });

    const coupon = coupons && coupons.length > 0 ? coupons[0] : null;

    if (error || !coupon) {
      return res.status(404).json({ success: false, code: 'INVALID_COUPON', message: 'Coupon not found.' });
    }

    if (coupon.is_used) {
      return res.status(400).json({ success: false, code: 'REDEEMED', message: 'Coupon already redeemed.' });
    }

    if (coupon.status === 'DISABLED') {
      return res.status(400).json({ success: false, code: 'DISABLED', message: 'Coupon disabled.' });
    }
    
    // Check if expired? (We can add logic later if needed)

    return res.json({
      success: true,
      couponId: coupon.id,
      amount: coupon.amount,
      currency: 'INR',
      status: coupon.status || 'ACTIVE'
    });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/v1/coupons/redeem
app.post('/api/v1/coupons/redeem', async (req, res) => {
  try {
    const { couponId, userId, gameId, walletTransactionId, ipAddress, device } = req.body;

    if (!couponId || !userId || !gameId || !walletTransactionId) {
      return res.status(400).json({ success: false, message: 'Missing required parameters.' });
    }

    // Attempt to redeem securely via Postgres Function or RPC to ensure atomicity
    // Alternatively, we use Supabase RPC that locks the row.
    const { data, error } = await supabase.rpc('redeem_game_coupon', {
      p_coupon_id: couponId,
      p_game_user_id: userId,
      p_game_id: gameId,
      p_wallet_transaction_id: walletTransactionId,
      p_ip_address: ipAddress || '0.0.0.0',
      p_device: device || 'unknown'
    });

    if (error) {
      console.error(error);
      return res.status(400).json({ success: false, code: 'REDEEM_FAILED', message: error.message });
    }

    return res.json({ success: true });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/v1/campaigns', async (req, res) => {
  const { data, error } = await supabase.from('campaigns').select('*').eq('is_active', true);
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.json({ success: true, data });
});

// POST /api/v1/wallet/transfer
app.post('/api/v1/wallet/transfer', async (req, res) => {
  try {
    const { userEmail, amount, transactionId } = req.body;

    if (!userEmail || !amount || !transactionId) {
      return res.status(400).json({ success: false, message: 'Missing required parameters.' });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid transfer amount.' });
    }

    const { data, error } = await supabase.rpc('transfer_winnings_to_wallet', {
      p_user_email: userEmail,
      p_amount: amount,
      p_transaction_id: transactionId
    });

    if (error) {
      console.error('Transfer Error:', error);
      // Handle unique constraint violation for idempotency
      if (error.code === '23505' || error.message.includes('unique constraint')) {
        return res.status(409).json({ success: false, code: 'DUPLICATE_TRANSACTION', message: 'Transaction already processed.' });
      }
      return res.status(400).json({ success: false, code: 'TRANSFER_FAILED', message: error.message });
    }

    return res.json({ success: true, message: 'Transfer successful', data });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/v1/coupons/:id', async (req, res) => {
  const { id } = req.params;
  const { data: coupon, error } = await supabase
    .from('coupons')
    .select('*, campaigns(*)')
    .eq('id', id)
    .single();
  
  if (error || !coupon) {
    return res.status(404).json({ success: false, message: 'Coupon not found' });
  }

  return res.json({ success: true, data: coupon });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Coupon API Server running on port ${PORT}`);
});
