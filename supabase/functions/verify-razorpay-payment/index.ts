// HIGH-03: Use shared CORS module — no wildcard origins
import { corsHeaders } from "../_shared/cors.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function sign(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
    if (!razorpayKeySecret) {
      return jsonResponse({ error: "Missing RAZORPAY_KEY_SECRET." }, 500);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body as {
      razorpay_order_id?: unknown;
      razorpay_payment_id?: unknown;
      razorpay_signature?: unknown;
    };
    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string"
    ) {
      return jsonResponse({ error: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required." }, 400);
    }

    const expectedSignature = await sign(
      `${razorpay_order_id}|${razorpay_payment_id}`,
      razorpayKeySecret,
    );

    // MED-01 FIX: Use timing-safe comparison to prevent timing-oracle attacks.
    // JavaScript's === short-circuits on the first mismatched byte, which
    // can theoretically leak how many leading hex characters are correct.
    // crypto.subtle.timingSafeEqual (via equal-length Uint8Array comparison)
    // runs in constant time regardless of where the mismatch occurs.
    const expectedBytes = new TextEncoder().encode(expectedSignature);
    const actualBytes   = new TextEncoder().encode(razorpay_signature);
    const verified =
      expectedBytes.length === actualBytes.length &&
      crypto.subtle.timingSafeEqual !== undefined
        // Modern Deno: use the built-in constant-time compare
        ? crypto.subtle.timingSafeEqual(expectedBytes, actualBytes)
        // Fallback: XOR-based constant-time compare (no short-circuit)
        : (() => {
            let diff = 0;
            for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i] ^ actualBytes[i];
            return diff === 0;
          })();

    if (!verified) {
      return jsonResponse({ verified: false, error: "Signature mismatch." }, 400);
    }

    return jsonResponse({ verified: true }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
