// Sends invite, rota and timesheet emails for the logged-in business only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Time Rogue <hello@timerogue.app>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = origin === "https://timerogue.app" || origin === "https://www.timerogue.app";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://timerogue.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;",
  }[c]));
}

function parseDay(str) {
  const [y, m, d] = String(str).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function formatLong(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

function calculateHours(entries) {
  const sorted = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let total = 0;
  let lastIn = null;
  for (const e of sorted) {
    const ts = new Date(e.timestamp);
    if (e.type === "in" || e.type === "break_end") lastIn = ts;
    else if ((e.type === "out" || e.type === "break_start") && lastIn) {
      total += (ts - lastIn) / (1000 * 60 * 60);
      lastIn = null;
    }
  }
  return total;
}

function shiftHtml(name, startDate, endDate, shifts) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const weekStart = parseDay(startDate);
  let totalHours = 0;
  let rows = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    const dateStr = dayKey(d);
    const dayShifts = (shifts || []).filter((s) => s.date === dateStr && (s.start_time || s.end_time));
    const hrs = dayShifts.reduce((sum, s) => sum + hoursBetween(s.start_time, s.end_time), 0);
    totalHours += hrs;
    const times = dayShifts.length
      ? dayShifts.map((s) => `<div style="font-size:1.05rem;">${escapeHtml(s.start_time || "")} – ${escapeHtml(s.end_time || "")}</div>`).join("")
        + `<div style="font-size:0.85rem; color:#64748b;">${hrs.toFixed(1)} hrs</div>`
      : '<div style="color:#94a3b8;">Off</div>';
    rows += `<tr>
      <td style="padding:0.75rem 0; border-bottom:1px solid #e2e8f0;">
        <div style="font-size:1.15rem; font-weight:600;">${days[i]}</div>
        <div style="font-size:0.9rem; color:#64748b;">${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</div>
      </td>
      <td style="padding:0.75rem 0; border-bottom:1px solid #e2e8f0; text-align:right;">${times}</td>
    </tr>`;
  }
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width:480px; margin:0 auto; color:#1e293b;">
    <h1 style="font-size:1.4rem; margin-bottom:0.25rem;">Your Shifts</h1>
    <p style="color:#64748b; margin-top:0;">${escapeHtml(name)}</p>
    <p style="color:#64748b; margin-top:0;">${formatLong(weekStart)} – ${formatLong(parseDay(endDate))}</p>
    <table style="width:100%; border-collapse:collapse; margin-top:1rem;">${rows}
      <tr>
        <td style="padding:1rem 0; font-weight:600;">Total</td>
        <td style="padding:1rem 0; text-align:right; font-weight:600;">${totalHours.toFixed(1)} hrs</td>
      </tr>
    </table>
    <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">Sent from Time Rogue</p>
  </div>`;
}

function timesheetHtml(startIso, endIso, clocks) {
  const byDate = {};
  (clocks || []).forEach((c) => {
    const date = new Date(c.timestamp).toISOString().slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(c);
  });
  let total = 0;
  let rows = "";
  Object.keys(byDate).sort().forEach((date) => {
    const hrs = calculateHours(byDate[date]);
    total += hrs;
    const label = new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    rows += `<tr>
      <td style="padding:0.6rem 0; border-bottom:1px solid #e2e8f0;">${label}</td>
      <td style="padding:0.6rem 0; border-bottom:1px solid #e2e8f0; text-align:right;">${hrs.toFixed(1)} hrs</td>
    </tr>`;
  });
  const startLabel = new Date(startIso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const endLabel = new Date(endIso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width:480px; margin:0 auto; color:#1e293b;">
    <h1 style="font-size:1.4rem;">Your Hours</h1>
    <p style="color:#64748b;">${startLabel} – ${endLabel}</p>
    <table style="width:100%; border-collapse:collapse; margin-top:1rem;">${rows}
      <tr><td style="padding:0.8rem 0; font-weight:600;">Total</td><td style="padding:0.8rem 0; text-align:right; font-weight:600;">${total.toFixed(1)} hrs</td></tr>
    </table>
    <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">Sent from Time Rogue</p>
  </div>`;
}

async function callerUser(req) {
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

async function portalLink(email) {
  const admin = adminClient();
  const redirectTo = "https://timerogue.app";
  const invite = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });
  if (!invite.error && invite.data?.properties?.email_otp) {
    if (invite.data.user?.id) {
      await admin.auth.admin.updateUserById(invite.data.user.id, { email_confirm: true });
    }
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
  if (recovery.data.user?.id) {
    await admin.auth.admin.updateUserById(recovery.data.user.id, { email_confirm: true });
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
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.message || data?.error || "Email failed";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders(req) });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });

  try {
    if (!RESEND_API_KEY) return json(req, { error: "Email is not configured" }, 500);
    const user = await callerUser(req);
    if (!user) return json(req, { error: "Please log in" }, 401);

    const body = await req.json();
    const staffId = body.staff_id;
    if (!staffId) return json(req, { error: "Missing staff_id" }, 400);

    const admin = adminClient();
    const { data: staff, error: staffError } = await admin
      .from("staff")
      .select("id, name, email, pin, hourly_rate, starter_form_data, owner_id")
      .eq("id", staffId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (staffError || !staff?.email) return json(req, { error: "Staff member not found or has no email" }, 403);

    if (body.action === "portal-invite") {
      const start = staff.starter_form_data?.agreed_start_date || "";
      const rate = staff.starter_form_data?.agreed_pay_rate || staff.hourly_rate || "";
      if (!start || !(parseFloat(String(rate)) > 0)) {
        return json(req, { error: "Set the agreed start date and pay rate before sending the invite." }, 400);
      }
      const setup = await portalLink(String(staff.email).trim());
      const startLabel = new Date(start + "T00:00:00").toLocaleDateString("en-GB");
      const setupUrl = "https://timerogue.app/?portal-setup=1&email=" + encodeURIComponent(String(staff.email).trim()) + "&kind=" + setup.kind;
      const inviteHtml = `
        <div style="font-family:Inter,system-ui,sans-serif;color:#0f172a;max-width:480px;">
          <h2 style="margin:0 0 0.5rem;">Your Time Rogue employee portal</h2>
          <p>Hello ${escapeHtml(staff.name)},</p>
          <p>Your agreed start date is <strong>${escapeHtml(startLabel)}</strong>.</p>
          <p>Your agreed pay rate is <strong>£${escapeHtml(rate)} per hour</strong>.</p>
          <p>Your clock-in code is <strong style="font-size:1.3rem;letter-spacing:0.15em;">${escapeHtml(staff.pin || "not set")}</strong>.</p>
          <p style="color:#64748b;font-size:0.9rem;">This code is not encrypted. Your manager can see it. You can change it in the employee portal.</p>
          <p>Your portal setup code is <strong style="font-size:1.3rem;letter-spacing:0.12em;">${escapeHtml(setup.otp)}</strong>.</p>
          <p style="color:#64748b;font-size:0.85rem;">This setup code expires in 24 hours. Your clock-in code does not expire.</p>
          <p><a href="${setupUrl}" style="display:inline-block;background:#0f172a;color:white;text-decoration:none;padding:0.7rem 1rem;border-radius:8px;">Set portal password</a></p>
          <p style="color:#64748b;font-size:0.85rem;">Enter that code, choose a password, then log in to the member portal. If it has expired, ask your manager to send the invite again.</p>
        </div>`;
      return json(req, await sendResend(staff.email, "Your Time Rogue employee portal", inviteHtml));
    }

    if (body.action === "shifts") {
      if (!body.start_date || !body.end_date) return json(req, { error: "Missing dates" }, 400);
      const { data: schedules, error } = await admin
        .from("schedules")
        .select("date, start_time, end_time, name")
        .eq("owner_id", user.id)
        .eq("name", staff.name)
        .gte("date", body.start_date)
        .lte("date", body.end_date)
        .order("date");
      if (error) throw error;
      const html = shiftHtml(staff.name, body.start_date, body.end_date, schedules || []);
      return json(req, await sendResend(staff.email, `Your shifts – ${formatLong(parseDay(body.start_date))}`, html));
    }

    if (body.action === "timesheet") {
      if (!body.start_iso || !body.end_iso) return json(req, { error: "Missing dates" }, 400);
      const { data: clocks, error } = await admin
        .from("clocks")
        .select("timestamp, type")
        .eq("staff_id", staff.id)
        .eq("owner_id", user.id)
        .gte("timestamp", body.start_iso)
        .lte("timestamp", body.end_iso)
        .order("timestamp");
      if (error) throw error;
      const html = timesheetHtml(body.start_iso, body.end_iso, clocks || []);
      return json(req, await sendResend(staff.email, "Your hours", html));
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (err) {
    return json(req, { error: err.message || String(err) }, 500);
  }
});
