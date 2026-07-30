// @ts-nocheck
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

async function getPayPalAccessToken(clientId: string, secret: string, baseUrl: string): Promise<string> {
  const credentials = btoa(`${clientId}:${secret}`);
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal Auth failed: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID") ?? "";
    const paypalSecret = Deno.env.get("PAYPAL_SECRET") ?? "";
    const paypalMode = Deno.env.get("PAYPAL_MODE") ?? "sandbox";

    if (!paypalClientId || !paypalSecret) {
      return jsonResponse(
        {
          error:
            "Missing PayPal server credentials. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET in Supabase Edge Function secrets.",
        },
        500,
      );
    }

    const paypalBaseUrl = paypalMode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const { order_id } = body as {
      order_id?: unknown;
    };

    if (typeof order_id !== "string" || !order_id) {
      return jsonResponse({ error: "order_id is required." }, 400);
    }

    // Get the Access Token
    let accessToken: string;
    try {
      accessToken = await getPayPalAccessToken(paypalClientId, paypalSecret, paypalBaseUrl);
    } catch (err: any) {
      return jsonResponse({ error: err.message || "Failed to authenticate with PayPal." }, 500);
    }

    // Capture the Order on PayPal
    const response = await fetch(`${paypalBaseUrl}/v2/checkout/orders/${order_id}/capture`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const payload = await response.json();

    if (!response.ok) {
      return jsonResponse(
        {
          verified: false,
          error: payload?.message || "Failed to capture PayPal order.",
          details: payload,
        },
        response.status,
      );
    }

    const isCompleted = payload.status === "COMPLETED";

    return jsonResponse(
      {
        verified: isCompleted,
        status: payload.status,
        details: payload,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ verified: false, error: message }, 500);
  }
});
