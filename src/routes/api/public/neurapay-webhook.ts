import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/neurapay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature =
          request.headers.get("x-neurapay-signature") ??
          request.headers.get("x-webhook-signature") ??
          request.headers.get("x-signature") ??
          request.headers.get("signature") ??
          "";
        const secret = process.env["NEURAPAY_WEBHOOK_SECRET"];
        const apiSecret = process.env["NEURAPAY_SECRET_KEY"];
        const businessId = process.env["NEURAPAY_BUSINESS_ID"];

        if (!secret || !apiSecret || !businessId) {
          return Response.json({ error: "Webhook is not configured." }, { status: 503 });
        }

        const {
          verifyNeuraPayWebhookSignature,
          makeNeuraPayConfig,
          verifyNeuraPayTransaction,
          findNeuraPayField,
          isRecord,
        } = await import("@/lib/neurapay.server");
        if (!(await verifyNeuraPayWebhookSignature(rawBody, signature, secret))) {
          return Response.json({ error: "Invalid signature." }, { status: 401 });
        }

        let event: unknown;
        try {
          event = JSON.parse(rawBody);
        } catch {
          return Response.json({ error: "Invalid event." }, { status: 400 });
        }
        if (!isRecord(event)) return Response.json({ error: "Invalid event." }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const referenceValue = findNeuraPayField(event, ["reference", "merchant_reference", "merchantReference"]);
        const providerReferenceValue = findNeuraPayField(event, ["transactionId", "transaction_id", "transactionReference", "transaction_reference"]);
        const accountNumberValue = findNeuraPayField(event, ["accountNumber", "account_number", "virtualAccountNumber", "virtual_account_number"]);
        let intent = null;

        if (referenceValue !== undefined) {
          const { data } = await supabaseAdmin
            .from("payment_intents")
            .select("reference,amount,status,provider_reference")
            .eq("provider", "neurapay")
            .eq("reference", String(referenceValue))
            .maybeSingle();
          intent = data;
        }
        if (!intent && providerReferenceValue !== undefined) {
          const { data } = await supabaseAdmin
            .from("payment_intents")
            .select("reference,amount,status,provider_reference")
            .eq("provider", "neurapay")
            .eq("provider_reference", String(providerReferenceValue))
            .maybeSingle();
          intent = data;
        }
        if (!intent && accountNumberValue !== undefined) {
          const { data: candidates } = await supabaseAdmin
            .from("payment_intents")
            .select("reference,amount,status,provider_reference,raw")
            .eq("provider", "neurapay")
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(200);
          intent = candidates?.find((candidate) =>
            String(findNeuraPayField(candidate.raw, ["accountNumber", "account_number", "virtualAccountNumber", "virtual_account_number"]) ?? "") === String(accountNumberValue),
          ) ?? null;
        }

        if (!intent) return Response.json({ received: true, credited: false, reason: "unknown_reference" });
        if (intent.status === "success") return Response.json({ received: true, credited: false, alreadyCredited: true });
        if (intent.status !== "pending") return Response.json({ received: true, credited: false, reason: "not_pending" });

        const gateway = makeNeuraPayConfig(
          apiSecret,
          businessId,
          secret,
          process.env["NEURAPAY_BASE_URL"],
        );
        const checked = await verifyNeuraPayTransaction(gateway, intent.reference, Number(intent.amount));
        if (!checked.confirmed) {
          return Response.json({ received: true, credited: false, status: checked.status });
        }

        const { data: settlement, error } = await supabaseAdmin.rpc("settle_neurapay_payment", {
          _reference: intent.reference,
          _amount: Number(intent.amount),
          ...(checked.providerReference ? { _provider_reference: checked.providerReference } : providerReferenceValue === undefined ? {} : { _provider_reference: String(providerReferenceValue) }),
          _provider_data: JSON.parse(JSON.stringify(checked.payload)),
        });
        if (error) {
          console.error("NeuraPay wallet settlement failed", { reference: intent.reference });
          return Response.json({ error: "Settlement could not be completed." }, { status: 500 });
        }
        return Response.json({ received: true, credited: settlement?.[0]?.credited ?? false, alreadyCredited: settlement?.[0]?.already_credited ?? false });
      },
    },
  },
});