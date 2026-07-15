import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCode } from 'react-qr-code';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, SearchX, Wallet, CreditCard, Activity, ArrowLeftRight, Gift, Zap, ShieldCheck, ArrowUpRight, ArrowDownLeft, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { DashboardCard } from '../components/GlassCard';
import { LoadingPage } from '../components/LoadingPage';
import type { Coupon, GiftCard, Order, RedemptionTransaction, Withdrawal } from '../lib/supabase';
import {
  getGiftCards,
  getRedemptionTransactions,
  getUserGiftCards,
  getUserOrders,
  getUserWalletBalance,
  purchaseGiftCard,
  updateUserWalletBalance,
  addFunds,
  createWithdrawal,
  getUserWithdrawals,
  createRazorpayOrder,
  verifyRazorpayPayment,
} from '../lib/supabase';

function loadScript(src: string) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const validSections = ['marketplace', 'wallet', 'activity', 'cards'] as const;
type UserSection = (typeof validSections)[number];

function isUserSection(value: string | undefined): value is UserSection {
  return !!value && validSections.includes(value as UserSection);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function UserDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();

  const currentSection: UserSection = isUserSection(section) ? section : 'marketplace';

  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [userVouchers, setUserVouchers] = useState<Coupon[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [priceFilter, setPriceFilter] = useState('All');

  const [walletBalance, setWalletBalance] = useState(0);

  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState(1);
  const [withdrawForm, setWithdrawForm] = useState({ routing: '', account: '', amount: '' });
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const [showAddMoneyModal, setShowAddMoneyModal] = useState(false);
  const [addMoneyAmount, setAddMoneyAmount] = useState('500');
  const [addMoneyLoading, setAddMoneyLoading] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<GiftCard | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [activeVoucher, setActiveVoucher] = useState<Coupon | null>(null);
  const [visibleCodes, setVisibleCodes] = useState<Record<string, boolean>>({});
  const [mockPaymentForm, setMockPaymentForm] = useState({
    name: 'Demo Customer',
    method: 'Card ending 4242',
  });

  useEffect(() => {
    if (!section) {
      navigate('/dashboard/marketplace', { replace: true });
      return;
    }

    if (!isUserSection(section)) {
      navigate('/dashboard/marketplace', { replace: true });
    }
  }, [navigate, section]);

  useEffect(() => {
    if (!user?.id) return;

    const syncWalletState = async () => {
      try {
        const balance = await getUserWalletBalance(user.id);
        setWalletBalance(balance);
      } catch (err) {
        console.error("Failed to sync wallet state:", err);
      }
    };

    void syncWalletState();
  }, [user]);

  async function refreshWalletBalance() {
    if (!user?.id) return;
    try {
      const balance = await getUserWalletBalance(user.id);
      setWalletBalance(balance);
    } catch (err: unknown) {
      console.warn("Could not fetch wallet balance:", err);
    }
  }

  const userId = user?.id;

  const toastErrorRef = useRef(toastError);
  useEffect(() => { toastErrorRef.current = toastError; }, [toastError]);

  const loadData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError(null);

      // Race the data loading against a 12-second timeout
      const loadTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Data loading timed out. Please try again.')), 12000)
      );

      const [cards, vouchers, userOrders, userRedemptions, userWithdrawals] = await Promise.race([
        Promise.all([
          getGiftCards(),
          getUserGiftCards(userId),
          getUserOrders(userId),
          getRedemptionTransactions(),
          getUserWithdrawals(userId),
        ]),
        loadTimeout,
      ]);

      setGiftCards(cards);
      setUserVouchers(vouchers);
      setOrders(userOrders);
      setWithdrawals(userWithdrawals);

      const voucherIds = vouchers.map((voucher) => voucher.id);
      setRedemptions(userRedemptions.filter((redemption) => voucherIds.includes(redemption.coupon_id)));
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to load dashboard details.');
      toastErrorRef.current('Load error', msg);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) return;

    const syncDashboard = async () => {
      await loadData();
    };

    void syncDashboard();
  }, [authLoading, userId, loadData]);

  const handleInitiatePurchase = (card: GiftCard) => {
    setSelectedProduct(card);
    setShowPaymentModal(true);
  };

  const handleConfirmWalletPayment = async () => {
    if (!selectedProduct || !user) return;

    if (walletBalance < selectedProduct.price) {
      toastError('Insufficient funds', 'Your wallet balance is lower than the purchase price.');
      return;
    }

    setPaymentLoading(true);
    const newBalance = walletBalance - selectedProduct.price;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // 1. Deduct wallet balance first
      await updateUserWalletBalance(user.id, newBalance);
      setWalletBalance(newBalance);

      // 2. Issue the gift card coupon
      const result = await purchaseGiftCard(
        selectedProduct.id,
        user.id,
        user.email || 'customer@demo.com',
        selectedProduct.price,
      );

      // 3. Re-sync balance from server to confirm
      await refreshWalletBalance();

      success('Payment authorized', `Voucher code generated: ${result.coupon_code}`);
      setShowPaymentModal(false);
      setSelectedProduct(null);
      navigate('/dashboard/cards');
      loadData();
    } catch (err: unknown) {
      // Rollback wallet deduction if coupon issuance failed
      try {
        await updateUserWalletBalance(user.id, walletBalance);
        setWalletBalance(walletBalance);
      } catch {
        // Best-effort rollback
      }
      toastError('Gateway error', getErrorMessage(err, 'Transaction authorization failed. Balance has been restored.'));
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleRazorpayPurchase = async () => {
    if (!selectedProduct || !user) return;

    setPaymentLoading(true);
    try {
      const res = await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      if (!res) throw new Error('Razorpay SDK failed to load');

      // Create the order server-side first so the amount can't be tampered
      // with on the client, and so we have an order id to verify against.
      const order = await createRazorpayOrder({
        amount: Math.round(selectedProduct.price * 100),
        currency: 'INR',
        receipt: `gc_${selectedProduct.id}_${Date.now()}`,
        notes: { user_id: user.id, gift_card_id: selectedProduct.id },
      });

      const options = {
        key: order.key_id,
        amount: order.amount.toString(),
        currency: order.currency,
        name: 'CouponVault Checkout',
        description: `Purchase ${selectedProduct.title}`,
        order_id: order.id || undefined,
        handler: async function (response: { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }) {
          try {
            // Never fulfil the order until the payment signature is
            // verified server-side - the client's word alone isn't proof.
            const { verified } = await verifyRazorpayPayment({
              razorpay_order_id: response.razorpay_order_id ?? '',
              razorpay_payment_id: response.razorpay_payment_id ?? '',
              razorpay_signature: response.razorpay_signature ?? '',
            });
            if (!verified) {
              toastError('Payment error', 'Payment could not be verified. No coupon was issued.');
              return;
            }

            const result = await purchaseGiftCard(
              selectedProduct.id,
              user.id,
              user.email || 'customer@demo.com',
              selectedProduct.price,
            );

            success('Payment approved', `Voucher code generated: ${result.coupon_code}`);
            setShowPaymentModal(false);
            setSelectedProduct(null);
            navigate('/dashboard/cards');
            loadData();
          } catch (err: unknown) {
            toastError('Fulfillment Error', getErrorMessage(err, 'Failed to complete purchase.'));
          }
        },
        prefill: { email: user.email || '' },
        theme: { color: '#8b5cf6' },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on('payment.failed', function (response: any) {
        toastError('Payment failed', response.error.description);
        setPaymentLoading(false);
      });
      paymentObject.open();
    } catch (err: unknown) {
      toastError('Payment error', getErrorMessage(err, 'Could not initialize checkout.'));
      setPaymentLoading(false);
    }
  };

  const handleWithdrawalSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;
    const amount = parseFloat(withdrawForm.amount);
    if (isNaN(amount) || amount <= 0 || amount > walletBalance) {
      toastError('Invalid amount', 'Check your wallet balance.');
      return;
    }

    setWithdrawLoading(true);
    setWithdrawStep(2); // Go to Razorpay Payouts processing view

    // Simulate connecting to Razorpay Payouts API
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const newBalance = walletBalance - amount;
      
      // Create withdrawal request in database
      await createWithdrawal(user.id, amount, withdrawForm.routing, withdrawForm.account);
      
      // Update local wallet balance state
      await updateUserWalletBalance(user.id, newBalance);
      await refreshWalletBalance();
      
      // Reload data to show new withdrawal
      await loadData();
      
      setWithdrawStep(3); // Go to success view
      success('Payout processed', `Razorpay Payout of ₹${amount.toFixed(2)} processed successfully.`);
    } catch (err: unknown) {
      setWithdrawStep(1); // Return to form on error
      toastError('Withdrawal error', getErrorMessage(err, 'Failed to process payout.'));
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleMockAddMoney = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountNum = parseFloat(addMoneyAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toastError('Invalid amount', 'Please enter a valid amount.');
      return;
    }

    setAddMoneyLoading(true);
    try {
      const res = await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      if (!res) {
        toastError('Gateway Error', 'Razorpay SDK failed to load. Are you online?');
        return;
      }

      const order = await createRazorpayOrder({
        amount: Math.round(amountNum * 100),
        currency: 'INR',
        receipt: `wallet_${user?.id ?? 'anon'}_${Date.now()}`,
        notes: { user_id: user?.id ?? '', purpose: 'wallet_topup' },
      });

      const options = {
        key: order.key_id,
        amount: order.amount.toString(),
        currency: order.currency,
        name: 'CouponVault Wallet',
        description: 'Add funds to wallet',
        order_id: order.id || undefined,
        handler: async function (response: { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }) {
          try {
            // Only credit the wallet once the payment signature has been
            // verified server-side. Never trust the checkout callback alone.
            const { verified } = await verifyRazorpayPayment({
              razorpay_order_id: response.razorpay_order_id ?? '',
              razorpay_payment_id: response.razorpay_payment_id ?? '',
              razorpay_signature: response.razorpay_signature ?? '',
            });
            if (!verified) {
              toastError('Payment error', 'Payment could not be verified. Your wallet was not credited.');
              return;
            }

            if (user?.id) {
              await addFunds(user.id, amountNum);
              await refreshWalletBalance();
            }
            success('Funds added', `Successfully added ₹${amountNum.toFixed(2)} to your wallet.`);
            setShowAddMoneyModal(false);
            setAddMoneyAmount('500');
          } catch (err: unknown) {
            toastError('Top-up Error', getErrorMessage(err, 'Failed to update wallet balance.'));
          }
        },
        prefill: { email: user?.email || '' },
        theme: { color: '#8b5cf6' },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on('payment.failed', function (response: any) {
        toastError('Payment failed', response.error?.description ?? 'The payment was declined.');
      });
      paymentObject.open();
    } catch (err: unknown) {
      toastError('Top-up error', getErrorMessage(err, 'Could not initiate checkout. No funds were added.'));
    } finally {
      setAddMoneyLoading(false);
    }
  };

  const combinedTransactions = useMemo(() => {
    const list: Array<{ date: string; brand: string; type: string; amount: string; status: string }> = [];

    orders.forEach((order) => {
      list.push({
        date: order.created_at,
        brand: order.company?.name || 'Marketplace purchase',
        type: 'Purchase',
        amount: `-₹${order.amount.toFixed(2)}`,
        status: 'Completed',
      });
    });

    redemptions.forEach((redemption) => {
      list.push({
        date: redemption.created_at,
        brand: redemption.company_name || 'Merchant',
        type: 'Redemption',
        amount: `-₹${redemption.amount.toFixed(2)}`,
        status: 'Settled',
      });
    });

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [orders, redemptions]);

  const filteredCatalog = useMemo(() => {
    return giftCards.filter((card) => {
      const matchesSearch =
        card.title.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        (card.company_name && card.company_name.toLowerCase().includes(catalogSearch.toLowerCase()));

      let matchesPrice = true;
      if (priceFilter === 'low') matchesPrice = card.price < 500;
      else if (priceFilter === 'mid') matchesPrice = card.price >= 500 && card.price <= 2000;
      else if (priceFilter === 'high') matchesPrice = card.price > 2000;

      return matchesSearch && matchesPrice;
    });
  }, [catalogSearch, giftCards, priceFilter]);

  const activeVoucherCount = userVouchers.filter((voucher) => !voucher.is_used).length;


  return (
    <div className="dashboard-container">

      {currentSection === 'marketplace' && (
        <div className="dashboard-section fade-in">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px', position: 'relative' }}>
              <SearchX size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ width: '100%', borderRadius: '99px', padding: '0.8rem 1.25rem 0.8rem 2.8rem', background: 'var(--surface-soft)' }}
                placeholder="Search brand or card..."
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
              />
            </div>
            <select className="input" style={{ width: 'auto', borderRadius: '99px', padding: '0.8rem 1.25rem', background: 'var(--surface-soft)' }} value={priceFilter} onChange={(event) => setPriceFilter(event.target.value)}>
              <option value="All">All prices</option>
              <option value="low">Under ₹500</option>
              <option value="mid">₹500 - ₹2000</option>
              <option value="high">Over ₹2000</option>
            </select>
          </div>

          {loading ? (
            <LoadingPage message="Loading marketplace..." />
          ) : loadError ? (
            <div className="glass-card-strong empty-state">
              <div className="empty-state__icon">
                <ShieldCheck size={28} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.15rem', fontWeight: 600 }}>Something went wrong</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem', maxWidth: '360px' }}>{loadError}</p>
              </div>
              <button className="btn btn-primary" onClick={() => loadData()} style={{ marginTop: '0.25rem' }}>
                Try again
              </button>
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="glass-card-strong empty-state">
              <div className="empty-state__icon">
                <SearchX size={28} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.15rem', fontWeight: 600 }}>No gift cards found</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem', maxWidth: '320px' }}>We couldn't find any active gift cards matching your search right now.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => { setCatalogSearch(''); setPriceFilter('All'); }} style={{ marginTop: '0.25rem' }}>
                Clear search filters
              </button>
            </div>
          ) : (
            <div className="responsive-grid-3 stagger-fade">
              {filteredCatalog.map((card) => {
                const val = card.value ?? 0;
                const prc = card.price ?? 0;
                const savings = val - prc;
                const savingsPct = val > 0 ? Math.round((savings / val) * 100) : 0;

                return (
                  <div key={card.id} className="card card-hover card-lift marketplace-card" style={{ padding: '1rem', position: 'relative' }}>
                    <div className="img-zoom"
                      style={{
                        minHeight: '220px',
                        borderRadius: '24px',
                        padding: '1.2rem',
                        color: '#fff',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <div className="marketplace-card-img" style={{ position: 'absolute', inset: 0, background: `url(${card.banner_image || 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=900&auto=format&fit=crop&q=60'}) center/cover`, zIndex: 0 }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgba(25,28,29,0.55), rgba(25,28,29,0.85))', zIndex: 1 }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 50%)', pointerEvents: 'none', borderRadius: '24px', zIndex: 2 }} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', position: 'relative', zIndex: 3 }}>
                        <span className="badge" style={{ background: 'rgba(128,249,200,0.2)', color: '#fff', backdropFilter: 'blur(8px)' }}>
                          Save {savingsPct}%
                        </span>
                      </div>
                      <div style={{ position: 'relative', zIndex: 3 }}>
                        <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{card.title}</div>
                        <div style={{ color: 'rgba(255,255,255,0.78)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Zap size={14} /> ₹{prc.toFixed(2)} now, value ₹{val.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div style={{ padding: '1rem 0.35rem 0 0.35rem' }}>
                      <p style={{ margin: '0 0 0.85rem', color: 'var(--text-3)', lineHeight: 1.6, fontSize: '0.88rem' }}>{card.description}</p>
                      
                      {card.issue_limit ? (() => {
                        const remaining = card.issue_limit - (card.issued_count || 0);
                        const isSoldOut = remaining <= 0;
                        return (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isSoldOut ? 'var(--red)' : 'var(--amber)' }}>
                              {isSoldOut ? 'Sold out!' : `Only ${remaining} left`}
                            </span>
                            <button 
                              className={`btn ${isSoldOut ? 'btn-secondary' : 'btn-primary'} btn-sm`} 
                              disabled={isSoldOut}
                              onClick={() => handleInitiatePurchase(card)}
                            >
                              {isSoldOut ? 'Out of stock' : 'Buy gift card'}
                            </button>
                          </div>
                        );
                      })() : (
                        <button className="btn btn-primary btn-sm" onClick={() => handleInitiatePurchase(card)}>
                          Buy gift card
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {currentSection === 'wallet' && (
        <div className="dashboard-section fade-in">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              marginBottom: '2rem'
            }}
          >
            <div>
              <span className="section-label">Customer experience</span>
              <h2 style={{ margin: '0.45rem 0 0.35rem', fontSize: '2rem', letterSpacing: '0.02em', wordSpacing: '0.1em' }}>
                Welcome back, {user?.email?.split('@')[0] || 'guest'}
              </h2>
              <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6, letterSpacing: '0.01em', wordSpacing: '0.08em' }}>
                Browse new cards, manage active vouchers, and keep redemptions close at hand.
              </p>
            </div>
          </div>

          <div className="bento-grid fade-in-cards" style={{ marginBottom: '2rem' }}>
            <DashboardCard title="Wallet balance" value={`₹${walletBalance.toFixed(2)}`} variant="primary" icon={<Wallet size={20} />} />
            <DashboardCard title="Active cards" value={String(activeVoucherCount)} variant="emerald" icon={<CreditCard size={20} />} />
            <DashboardCard title="Transactions" value={String(combinedTransactions.length)} variant="violet" icon={<ArrowLeftRight size={20} />} />
            <DashboardCard title="Redeemed value" value={`₹${redemptions.reduce((acc, r) => acc + (r.amount ?? 0), 0).toFixed(2)}`} variant="amber" icon={<Gift size={20} />} />
          </div>

          <div className="responsive-grid-2">
            <div className="premium-gradient-card" style={{ padding: '1.6rem' }}>
              <div className="premium-gradient-card__bg" />
              <div className="premium-gradient-card__shimmer" />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span className="section-label" style={{ color: 'rgba(255,255,255,0.85)', letterSpacing: '0.15em' }}>
                    <Wallet size={14} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                    Wallet balance
                  </span>
                  <span className="glow-dot" />
                </div>
                <div style={{ fontSize: '2.8rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', lineHeight: 1 }}>₹{walletBalance.toFixed(2)}</div>
                <p style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, marginTop: '0.75rem', fontSize: '0.92rem' }}>
                  Use your stored balance for instant purchases, top up funds, and test wallet flows with the mock gateway.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowAddMoneyModal(true); }}
                    style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.25)', backdropFilter: 'blur(8px)' }}
                  >
                    Add money
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setWithdrawStep(1); setShowWithdrawModal(true); }}
                    style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}
                  >
                    Withdraw money
                  </button>
                </div>
              </div>
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div className="section-label" style={{ marginBottom: '0.75rem' }}>Portfolio summary</div>
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.4)', borderRadius: '14px' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>Owned cards</span>
                  <strong style={{ fontSize: '1.1rem' }}>{userVouchers.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.4)', borderRadius: '14px' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>Redeemed amount</span>
                  <strong style={{ fontSize: '1.1rem' }}>₹{redemptions.reduce((acc, r) => acc + (r.amount ?? 0), 0).toFixed(2)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.4)', borderRadius: '14px' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>Recent orders</span>
                  <strong style={{ fontSize: '1.1rem' }}>{orders.length}</strong>
                </div>
              </div>
            </div>
          </div>

          {withdrawals.length > 0 && (
            <div className="glass-card-strong" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div className="section-label" style={{ marginBottom: '1rem' }}>Withdrawal History</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td className="mono" style={{ fontSize: '0.82rem' }}>{new Date(w.created_at).toLocaleString()}</td>
                        <td className="mono font-medium">₹{w.amount.toFixed(2)}</td>
                        <td>
                          <span className={`badge ${w.status === 'completed' ? 'badge-green' : w.status === 'rejected' ? 'badge-red' : 'badge-amber'}`}>
                            {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                          </span>
                        </td>
                        <td className="mono text-muted">...{w.account_number.slice(-4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div aria-live="polite" className="glass-card-strong" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span className="section-label">Quick actions</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.2rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Move between balance, activity, and active cards</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/cards')}>
                <CreditCard size={14} /> View cards
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/activity')}>
                <Activity size={14} /> Activity
              </button>
            </div>
          </div>
        </div>
      )}

      {currentSection === 'activity' && (
        <div className="glass-card-strong fade-in" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1.5px solid rgba(255,255,255,0.4)' }}>
            <span className="section-label"><Activity size={13} style={{ display: 'inline', marginRight: '0.3rem', verticalAlign: 'middle' }} /> Timeline</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
              Transaction and settlement activity
            </h3>
          </div>
          {combinedTransactions.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem' }}>
              <div className="empty-state__icon"><Activity size={24} /></div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.05rem', fontWeight: 600 }}>No activity yet</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>Your purchases and redemptions will appear here.</p>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Merchant</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {combinedTransactions.map((transaction, index) => (
                    <tr key={`${transaction.date}-${index}`}>
                      <td className="mono" style={{ fontSize: '0.82rem' }}>{new Date(transaction.date).toLocaleString()}</td>
                      <td>{transaction.brand}</td>
                      <td>
                        <span className={`badge ${transaction.type === 'Purchase' ? 'badge-purple' : 'badge-green'}`}>
                          {transaction.type}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>{transaction.amount}</td>
                      <td><span className="badge badge-green" style={{ fontSize: '0.65rem' }}>{transaction.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {currentSection === 'cards' && (
        <div className="dashboard-section fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span className="section-label"><CreditCard size={13} style={{ display: 'inline', marginRight: '0.3rem', verticalAlign: 'middle' }} /> Active vouchers</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.4rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Stored gift cards</h3>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/marketplace')}>
              <Gift size={14} /> Buy another card
            </button>
          </div>

          {userVouchers.length === 0 ? (
            <div className="glass-card-strong empty-state">
              <div className="empty-state__icon"><CreditCard size={26} /></div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.1rem', fontWeight: 600 }}>No vouchers yet</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>Buy a gift card from the marketplace to see your vouchers here.</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/dashboard/marketplace')} style={{ marginTop: '0.25rem' }}>
                <Gift size={14} /> Browse marketplace
              </button>
            </div>
          ) : (
            <>
              {(() => {
                const activeVouchersList = userVouchers.filter(v => v.status !== 'redeemed' && !v.is_used);
                const redeemedVouchersList = userVouchers.filter(v => v.status === 'redeemed' || v.is_used);

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                    {activeVouchersList.length > 0 ? (
                      <div className="responsive-grid-3">
                        {activeVouchersList.map((voucher) => (
                          <div
                            key={voucher.id}
                            className="glass-card-glow"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && setActiveVoucher(voucher)}
                            onClick={() => setActiveVoucher(voucher)}
                            style={{ padding: '1rem', textAlign: 'left', cursor: 'pointer' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                              <div>
                                <div className="section-label" style={{ marginBottom: '0.3rem' }}>
                                  <Gift size={12} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                  {voucher.company_name || 'Brand partner'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <div style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '0.92rem', letterSpacing: '0.02em' }}>
                                    {visibleCodes[voucher.id] ? voucher.code : '••••••••••••'}
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setVisibleCodes(prev => ({ ...prev, [voucher.id]: !prev[voucher.id] })); }}
                                    style={{ background: 'rgba(255,255,255,0.4)', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px', borderRadius: '8px', display: 'flex' }}
                                  >
                                    {visibleCodes[voucher.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                  </button>
                                </div>
                              </div>
                              <span className="badge badge-green">{voucher.status}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 0 0', borderTop: '1.5px solid rgba(255,255,255,0.35)' }}>
                              <div>
                                <div style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>Remaining</div>
                                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>₹{(voucher.remaining_balance ?? 0).toFixed(2)}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>Expires</div>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{new Date(voucher.expiry_date).toLocaleDateString()}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="glass-card-strong empty-state" style={{ padding: '1.5rem' }}>
                        <div className="empty-state__icon" style={{ width: 44, height: 44 }}><CreditCard size={20} /></div>
                        <div>
                          <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>No active vouchers right now.</p>
                        </div>
                      </div>
                    )}

                    {redeemedVouchersList.length > 0 && (
                      <div>
                        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span className="section-label">Past vouchers</span>
                          <span className="badge badge-gray" style={{ fontSize: '0.6rem' }}>{redeemedVouchersList.length}</span>
                        </div>
                        <div className="responsive-grid-3">
                          {redeemedVouchersList.map((voucher) => (
                            <div
                              key={voucher.id}
                              className="glass-card-strong"
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === 'Enter' && setActiveVoucher(voucher)}
                              onClick={() => setActiveVoucher(voucher)}
                              style={{ padding: '1rem', textAlign: 'left', opacity: 0.75, cursor: 'pointer' }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                  <div className="section-label" style={{ marginBottom: '0.3rem', color: 'var(--text-4)' }}>
                                    {voucher.company_name || 'Brand partner'}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-3)', fontSize: '0.92rem' }}>
                                      {visibleCodes[voucher.id] ? voucher.code : '••••••••••••'}
                                    </div>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setVisibleCodes(prev => ({ ...prev, [voucher.id]: !prev[voucher.id] })); }}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 0, display: 'flex' }}
                                    >
                                      {visibleCodes[voucher.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                  </div>
                                </div>
                                <span className="badge badge-gray">{voucher.status}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 0 0', borderTop: '1.5px solid rgba(255,255,255,0.25)' }}>
                                <div>
                                  <div style={{ color: 'var(--text-4)', fontSize: '0.78rem' }}>Remaining</div>
                                  <div style={{ fontWeight: 700, color: 'var(--text-3)' }}>₹{(voucher.remaining_balance ?? 0).toFixed(2)}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ color: 'var(--text-4)', fontSize: '0.78rem' }}>Expires</div>
                                  <div style={{ fontWeight: 700, color: 'var(--text-3)' }}>{new Date(voucher.expiry_date).toLocaleDateString()}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {activeVoucher && (
        <div className="glass-modal-overlay" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: '1rem', zIndex: 50 }}>
          <div className="glass-modal-panel fade-in" style={{ maxWidth: '420px', width: '100%', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <span className="section-label"><ShieldCheck size={13} style={{ display: 'inline', marginRight: '0.3rem', verticalAlign: 'middle' }} /> Ready to scan</span>
                <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.4rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
                  {activeVoucher.company_name || 'Voucher'}
                </h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveVoucher(null)}>
                Close
              </button>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '24px', padding: '1.2rem', display: 'grid', placeItems: 'center' }}>
              <QRCode value={activeVoucher.code} size={190} fgColor="#191c1d" />
            </div>

            <div className="glass-card-strong" style={{ borderRadius: '20px', padding: '1rem', marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginBottom: '0.45rem' }}>
                <div className="mono" style={{ fontWeight: 800, letterSpacing: '0.04em' }}>
                  {visibleCodes[activeVoucher.id] ? activeVoucher.code : '••••••••••••'}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setVisibleCodes(prev => ({ ...prev, [activeVoucher.id]: !prev[activeVoucher.id] })); }}
                  style={{ background: 'rgba(255,255,255,0.4)', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: '4px', borderRadius: '8px', display: 'flex' }}
                >
                  {visibleCodes[activeVoucher.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', color: 'var(--text-3)' }}>
                <span><strong>₹{(activeVoucher.remaining_balance ?? 0).toFixed(2)}</strong> remaining</span>
                <span>Expires {new Date(activeVoucher.expiry_date).toLocaleDateString()}</span>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1rem' }}
              onClick={async () => {
                let successCopy = false;
                try {
                  if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(activeVoucher.code);
                    successCopy = true;
                  } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = activeVoucher.code;
                    textArea.style.position = "fixed";
                    textArea.style.left = "-999999px";
                    textArea.style.top = "-999999px";
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    successCopy = document.execCommand('copy');
                    textArea.remove();
                  }
                } catch {
                  // successCopy already false unless a write path above succeeded
                }
                
                if (successCopy) {
                  success('Copied ticket code', 'Paste this in the merchant scan box.');
                } else {
                  success('Ticket code ready', 'Please select and copy the code manually.');
                }
              }}
            >
              Copy voucher code
            </button>
          </div>
        </div>
      )}

      {showPaymentModal && selectedProduct && (
        <div className="glass-modal-overlay" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, overflow: 'auto', padding: '1rem' }}>
          <div className="glass-modal-panel fade-in" style={{ width: '100%', maxWidth: '480px', margin: 'auto', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem', borderRadius: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
              <div>
                <span className="section-label"><Zap size={13} style={{ display: 'inline', marginRight: '0.3rem', verticalAlign: 'middle' }} /> Checkout</span>
                <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.4rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
                  {selectedProduct.title}
                </h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowPaymentModal(false); setSelectedProduct(null); }} style={{ flexShrink: 0 }}>
                Close
              </button>
            </div>

            <div className="glass-card-strong" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem', fontSize: '0.95rem' }}>
                <span style={{ color: 'var(--text-3)' }}>Face Value</span>
                <strong>₹{(selectedProduct.value ?? 0).toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem', fontSize: '0.95rem' }}>
                <span style={{ color: 'var(--text-3)' }}>Purchase Price</span>
                <strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>₹{(selectedProduct.price ?? 0).toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-3)' }}>Cashback (10%)</span>
                <strong style={{ color: '#10b981' }}>+₹{((selectedProduct.value ?? 0) * 0.1).toFixed(2)}</strong>
              </div>
            </div>

            <div className="glass-card-strong" style={{ padding: '1rem', borderRadius: '16px', display: 'grid', gap: '0.6rem' }}>
              <div>
                <label className="label">Name on payment</label>
                <input
                  className="input"
                  value={mockPaymentForm.name}
                  onChange={(event) => setMockPaymentForm({ ...mockPaymentForm, name: event.target.value })}
                />
              </div>
              <div>
                <label className="label">Payment method</label>
                <select
                  className="input"
                  value={mockPaymentForm.method}
                  onChange={(event) => setMockPaymentForm({ ...mockPaymentForm, method: event.target.value })}
                >
                  <option>Card ending 4242</option>
                  <option>UPI demo handle</option>
                  <option>Netbanking sandbox</option>
                </select>
              </div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleRazorpayPurchase} disabled={paymentLoading}>
              {paymentLoading ? (
                <><span className="spinner" /> Processing...</>
              ) : 'Pay with Razorpay'}
            </button>

            <div style={{ position: 'relative', textAlign: 'center', margin: '0.15rem 0' }}>
              <span style={{ background: '#ffffff', padding: '0 0.75rem', position: 'relative', zIndex: 1, fontSize: '0.7rem', color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.08em' }}>
                OR PAY WITH WALLET
              </span>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.1)' }} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div style={{ flex: 1, padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '14px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>Wallet</div>
                <strong style={{ fontSize: '1rem' }}>₹{walletBalance.toFixed(2)}</strong>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                disabled={paymentLoading || walletBalance < selectedProduct.price}
                onClick={handleConfirmWalletPayment}
              >
                {walletBalance < selectedProduct.price ? 'Insufficient' : 'Pay from Wallet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWithdrawModal && (
        <div className="glass-modal-overlay" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: '1rem', zIndex: 50, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)' }}>
          <div className="glass-modal-panel fade-in" style={{ maxWidth: '440px', width: '100%', padding: '2rem', borderRadius: '24px', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-hero)' }}>
            {withdrawStep === 1 && (
              <form onSubmit={handleWithdrawalSubmit} style={{ display: 'grid', gap: '1.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                      <ArrowDownLeft size={18} />
                    </div>
                    <div>
                      <span className="section-label" style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>Payout request</span>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Withdraw funds</h3>
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowWithdrawModal(false)} style={{ borderRadius: '10px' }}>
                    Cancel
                  </button>
                </div>

                <div style={{ padding: '1rem', background: 'var(--surface-soft)', borderRadius: '14px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-3)' }}>Available balance</span>
                  <strong style={{ fontSize: '1.1rem', color: 'var(--text-1)' }}>₹{walletBalance.toFixed(2)}</strong>
                </div>

                <div>
                  <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>Amount (INR)</label>
                  <input className="input mono" type="number" step="0.01" max={walletBalance} required value={withdrawForm.amount} onChange={(event) => setWithdrawForm({ ...withdrawForm, amount: event.target.value })} placeholder="0.00" style={{ width: '100%', fontSize: '1.1rem', padding: '0.75rem 1rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>IFSC / Routing code</label>
                  <input className="input mono" required value={withdrawForm.routing} onChange={(event) => setWithdrawForm({ ...withdrawForm, routing: event.target.value })} placeholder="e.g. SBIN0001234" style={{ width: '100%', padding: '0.75rem 1rem' }} />
                </div>
                <div>
                  <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>Bank account number</label>
                  <input className="input mono" required value={withdrawForm.account} onChange={(event) => setWithdrawForm({ ...withdrawForm, account: event.target.value })} placeholder="Enter account number" style={{ width: '100%', padding: '0.75rem 1rem' }} />
                </div>

                <button className="btn btn-primary" disabled={withdrawLoading} type="submit" style={{ padding: '0.9rem', fontSize: '0.95rem', fontWeight: 700, borderRadius: '12px' }}>
                  Confirm Payout
                </button>
              </form>
            )}

            {withdrawStep === 2 && (
              <div style={{ textAlign: 'center', display: 'grid', gap: '1.2rem', padding: '2rem 0' }}>
                <span className="spinner" style={{ margin: '0 auto', width: '48px', height: '48px', borderWidth: '4px', borderColor: 'var(--primary) transparent transparent transparent' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Connecting to Razorpay...</h3>
                  <p style={{ margin: '0.4rem 0 0', color: 'var(--text-3)', fontSize: '0.9rem', lineHeight: 1.5 }}>Verifying bank routing details and securing connection.</p>
                </div>
              </div>
            )}

            {withdrawStep === 3 && (
              <div style={{ textAlign: 'center', display: 'grid', gap: '1.2rem', padding: '1rem 0' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--green-muted)', border: '1px solid var(--green-border)', display: 'grid', placeItems: 'center', margin: '0 auto', color: 'var(--green)' }}>
                  <CheckCircle2 size={28} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Payout Sent</h3>
                  <p style={{ margin: '0.5rem 0 0', color: 'var(--text-3)', lineHeight: 1.6, fontSize: '0.92rem' }}>
                    Your funds of <strong>₹{parseFloat(withdrawForm.amount).toFixed(2)}</strong> are being transferred to account ending in <strong>...{withdrawForm.account.slice(-4)}</strong>.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={() => setShowWithdrawModal(false)} style={{ borderRadius: '12px', padding: '0.75rem' }}>
                  Return to Dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showAddMoneyModal && (
        <div className="glass-modal-overlay" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: '1rem', zIndex: 50, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)' }}>
          <div className="glass-modal-panel fade-in" style={{ maxWidth: '440px', width: '100%', padding: '2rem', borderRadius: '24px', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-hero)' }}>
            <form onSubmit={handleMockAddMoney} style={{ display: 'grid', gap: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                    <ArrowUpRight size={18} />
                  </div>
                  <div>
                    <span className="section-label" style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>Top-up wallet</span>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Add funds</h3>
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowAddMoneyModal(false)} style={{ borderRadius: '10px' }}>
                  Close
                </button>
              </div>

              <div>
                <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>Amount (INR)</label>
                <input className="input mono" type="number" min="1" required value={addMoneyAmount} onChange={(event) => setAddMoneyAmount(event.target.value)} style={{ width: '100%', fontSize: '1.2rem', padding: '0.75rem 1rem' }} />
              </div>

              {/* Quick top-up chips */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                {['500', '1000', '2000', '5000'].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAddMoneyAmount(val)}
                    style={{
                      background: addMoneyAmount === val ? 'var(--primary-muted)' : 'var(--surface-soft)',
                      borderColor: addMoneyAmount === val ? 'var(--primary)' : 'var(--border)',
                      color: addMoneyAmount === val ? 'var(--primary)' : 'var(--text-2)',
                      fontWeight: 600,
                      borderRadius: '10px'
                    }}
                  >
                    +₹{val}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'var(--surface-soft)', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-3)' }}>
                <ShieldCheck size={14} style={{ color: 'var(--green)' }} />
                <span>Secure payment gateway powered by Razorpay.</span>
              </div>

              <button className="btn btn-primary" disabled={addMoneyLoading} type="submit" style={{ padding: '0.9rem', fontSize: '0.95rem', fontWeight: 700, borderRadius: '12px' }}>
                {addMoneyLoading ? <><span className="spinner" /> Connecting...</> : 'Pay with Razorpay'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
