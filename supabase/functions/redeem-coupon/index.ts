// supabase/functions/redeem-coupon/index.ts
// Edge Function: Allow external sites to validate and redeem a coupon code
// Deploy: supabase functions deploy redeem-coupon

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { coupon_code, amount } = await req.json();

    if (!coupon_code) {
      return new Response(JSON.stringify({ error: "coupon_code is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redeemAmount = amount ? parseFloat(amount) : null;

    // 1. Look up the coupon
    const { data: coupon, error: lookupError } = await supabaseClient
      .from("coupons")
      .select("id, code, is_used, status, remaining_balance")
      .eq("code", coupon_code)
      .maybeSingle();

    if (lookupError || !coupon) {
      return new Response(JSON.stringify({ error: "Coupon not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (coupon.is_used || coupon.status === "redeemed") {
      return new Response(JSON.stringify({ error: "Coupon already fully redeemed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine the amount to redeem
    // If not specified, redeem the remaining balance
    const amountToRedeem = redeemAmount !== null ? redeemAmount : coupon.remaining_balance;

    if (amountToRedeem <= 0) {
      return new Response(JSON.stringify({ error: "Invalid redeem amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Call the RPC to redeem
    const { data: redeemResult, error: redeemError } = await supabaseClient
      .rpc("redeem_coupon_amount", {
        p_coupon_id: coupon.id,
        p_amount: amountToRedeem,
      });

    if (redeemError) {
      return new Response(JSON.stringify({ error: redeemError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resultRow = Array.isArray(redeemResult) ? redeemResult[0] : redeemResult;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Coupon redeemed successfully",
        redeemed_amount: amountToRedeem,
        remaining_balance: resultRow?.remaining_balance ?? 0,
        status: resultRow?.status ?? "redeemed",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("redeem-coupon error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
