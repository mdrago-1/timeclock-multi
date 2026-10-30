// Supabase Edge Function to send emails via Resend
// Also creates the employee portal login link.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Time Rogue <hello@timerogue.app>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function portalLink(email) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );
  const redirectTo = "https://timerogue.app";
  const invite = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });
  if (!invite.error && invite.data?.properties?.email_otp) {
    return { otp: invite.data.properties.email_otp, kind: "invite" };
  }
  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (recovery.error || !recovery.data?.properties?.email_otp) {
    throw new Error(recovery.error?.message || invite.error?.message || "Could not create a login code");
  }
  return { otp: recovery.data.properties.email_otp, kind: "recovery" };
}

async function sendResend(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.message || data?.error || "Email failed";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const { to, subject, html, action, name, pin } = body;

    if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not set" }, 500);
    if (!to) return json({ error: "Missing recipient" }, 400);

    if (action === "portal-invite") {
      const setup = await portalLink(String(to).trim());
      const safeName = String(name || "").replace(/[<>]/g, "");
      const safePin = String(pin || "not set").replace(/[<>]/g, "");
      const safeOtp = String(setup.otp || "").replace(/[<>]/g, "");
      const setupUrl = "https://timerogue.app/?portal-setup=1&email=" + encodeURIComponent(String(to).trim()) + "&kind=" + setup.kind;
      const inviteHtml = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#0f172a;max-width:480px;">
          <h2 style="margin:0 0 0.5rem;">Your Time Rogue employee portal</h2>
          <p>Hello ${safeName},</p>
          <p>Your clock-in code is <strong style="font-size:1.3rem;letter-spacing:0.15em;">${safePin}</strong>.</p>
          <p style="color:#64748b;font-size:0.9rem;">This code is not encrypted. Your manager can see it. You can change it in the employee portal.</p>
          <p>Your portal setup code is <strong style="font-size:1.3rem;letter-spacing:0.12em;">${safeOtp}</strong>.</p>
          <p><a href="${setupUrl}" style="display:inline-block;background:#0f172a;color:white;text-decoration:none;padding:0.7rem 1rem;border-radius:8px;">Set portal password</a></p>
          <p style="color:#64748b;font-size:0.85rem;">Enter that code, choose a password, then log in to the member portal.</p>
        </div>`;
      const data = await sendResend(to, subject || "Your Time Rogue employee portal", inviteHtml);
      return json(data);
    }

    if (!subject || !html) return json({ error: "Missing to, subject, or html" }, 400);
    const data = await sendResend(to, subject, html);
    return json(data);
  } catch (err) {
    return json({ error: err.message || String(err) }, 500);
  }
});
