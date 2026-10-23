// Multi-tenant TimeClock app with profiles, documents, and export
let currentPin = '';
let currentStaff = null;
let currentUser = null;
let selectedRange = 'this-week';
let currentWeekOffset = 0;
let ADMIN_PASSWORD = localStorage.getItem('admin_password') || 'Admin0506';
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB

document.addEventListener('DOMContentLoaded', async () => {
  try {
    applyClockStyle();

    // Detect password recovery flow from the URL hash
    const hash = window.location.hash || '';
    const isRecovery = hash.includes('type=recovery') || hash.includes('access_token');

    if (isRecovery) {
      // Supabase will have already set the session from the recovery link
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        currentUser = session.user;
        showPasswordResetForm();
        // Clean the hash so a refresh doesn't re-trigger
        history.replaceState(null, '', window.location.pathname);
        return;
      }
    }

    const { data: { session } } = await db.auth.getSession();
    if (session) {
      currentUser = session.user;
      await refreshPaidStatus();
      showKiosk();
    } else {
      showAuth();
    }
  } catch (err) {
    console.error('Startup error:', err);
    showAuth();
  }
  setupEventListeners();
  setInterval(updateTime, 1000);
  updateTime();
  updatePinDots();
});

function updateTime() {
  applyClockStyle();
  const el = document.getElementById('current-time');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updatePinDots() {
  const container = document.getElementById('pin-dots');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const dot = document.createElement('div');
    dot.className = 'pin-dot' + (i < currentPin.length ? ' filled' : '');
    container.appendChild(dot);
  }
}

function setupEventListeners() {
  const authForm = document.getElementById('auth-form');
  if (authForm) {
    authForm.onsubmit = (e) => { e.preventDefault(); login(e); return false; };
  }
  document.getElementById('signup-btn')?.addEventListener('click', showPlanChoice);
  document.getElementById('login-btn')?.addEventListener('click', () => {
    const m = document.getElementById('login-modal');
    if (m) m.style.display = 'flex';
  });
  document.getElementById('login-cancel')?.addEventListener('click', () => {
    const m = document.getElementById('login-modal');
    if (m) m.style.display = 'none';
  });
  document.getElementById('forgot-btn')?.addEventListener('click', () => {
    const m = document.getElementById('forgot-modal');
    if (m) m.style.display = 'flex';
  });
  document.getElementById('forgot-cancel')?.addEventListener('click', () => {
    const m = document.getElementById('forgot-modal');
    if (m) m.style.display = 'none';
  });
  document.getElementById('forgot-submit')?.addEventListener('click', () => {
    const email = document.getElementById('forgot-email')?.value;
    if (!email) return alert('Enter your email');
    db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }).then(({ error }) => {
      if (error) return alert(error.message);
      alert('Password reset email sent. Check your inbox.');
      document.getElementById('forgot-modal').style.display = 'none';
    });
  });
  document.getElementById('kiosk-login-btn')?.addEventListener('click', showKioskLoginPanel);
  document.getElementById('kiosk-code-submit')?.addEventListener('click', kioskLoginWithCode);
  document.getElementById('kiosk-code-cancel')?.addEventListener('click', hideKioskLoginPanel);
  document.getElementById('admin-btn')?.addEventListener('click', showAdminPassword);
  document.getElementById('exit-admin')?.addEventListener('click', showKiosk);
  document.getElementById('back-to-pin')?.addEventListener('click', showPin);
  document.getElementById('member-btn')?.addEventListener('click', showMemberLogin);
  document.getElementById('cancel-admin')?.addEventListener('click', showKiosk);
  document.getElementById('cancel-member')?.addEventListener('click', showKiosk);
  document.getElementById('exit-member')?.addEventListener('click', showKiosk);

  const adminPwForm = document.getElementById('admin-password-form');
  if (adminPwForm) {
    adminPwForm.onsubmit = (e) => { e.preventDefault(); checkAdminPassword(e); return false; };
  }
  const memberForm = document.getElementById('member-login-form');
  if (memberForm) {
    memberForm.onsubmit = (e) => { e.preventDefault(); memberLogin(e); return false; };
  }

  const keypad = document.getElementById('keypad');
  if (keypad && !keypad.children.length) {
    ['1','2','3','4','5','6','7','8','9','C','0','\u2713'].forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'key';
      btn.textContent = d;
      btn.addEventListener('click', () => handleKey(d));
      keypad.appendChild(btn);
    });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(tab.dataset.tab + '-tab');
      if (content) content.classList.add('active');
      if (tab.dataset.tab === 'timesheets') loadTimesheets();
      if (tab.dataset.tab === 'staff') loadStaff();
      if (tab.dataset.tab === 'schedule') {
        if (!hasSubscription()) {
          showPaywall('Scheduling');
          // Switch back to staff tab
          document.querySelector('.tab[data-tab="staff"]').click();
          return;
        }
        loadSchedule();
      }
      if (tab.dataset.tab === 'holiday') loadHoliday();
      if (tab.dataset.tab === 'settings') loadSettings();
      if (tab.dataset.tab === 'statutory') loadStatutory();
    });
  });
}

let isUserPaid = false;

async function refreshPaidStatus() {
  if (!currentUser) { isUserPaid = false; return; }
  const { data } = await db.from('profiles').select('paid, subscription_until').eq('id', currentUser.id).single();
  const now = new Date();
  const trialActive = data?.subscription_until && new Date(data.subscription_until) > now;
  isUserPaid = !!(data?.paid && trialActive) || !!(data?.subscription_until && new Date(data.subscription_until) > now);
  // Also honour a simple paid flag for the one-off (clock/timesheets always available if paid)
  // For subscription features we use the trial/subscription window
  window._subscriptionActive = trialActive || !!(data?.subscription_until && new Date(data.subscription_until) > now);

  if (!data?.paid && currentUser.email) {
    const { data: pending } = await db.from('pending_payments').select('paid').eq('email', currentUser.email.toLowerCase()).maybeSingle();
    if (pending?.paid) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      await db.from('profiles').update({ 
        paid: true, 
        subscription_until: trialEnd.toISOString() 
      }).eq('id', currentUser.id);
      isUserPaid = true;
      window._subscriptionActive = true;
    }
  }
}

function isPaid() {
  // One-off purchase unlocks basic features
  return isUserPaid;
}

function hasSubscription() {
  return !!window._subscriptionActive;
}

function appConfirm(message) {
  return new Promise(resolve => {
    let modal = document.getElementById('app-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'app-confirm-modal';
      modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:300; display:flex; align-items:center; justify-content:center; padding:1rem;';
      modal.innerHTML = `
        <div style="background:white; border-radius:12px; padding:1.5rem; max-width:340px; width:100%; text-align:center;">
          <p id="app-confirm-msg" style="margin:0 0 1.25rem; color:#0f172a;"></p>
          <div style="display:flex; gap:0.5rem; justify-content:center;">
            <button type="button" id="app-confirm-cancel" style="background:transparent; color:#64748b; border:1px solid #e2e8f0;">Cancel</button>
            <button type="button" id="app-confirm-ok" style="background:#0f172a; color:white;">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    document.getElementById('app-confirm-msg').textContent = message;
    modal.style.display = 'flex';
    const cleanup = (result) => {
      modal.style.display = 'none';
      resolve(result);
    };
    document.getElementById('app-confirm-ok').onclick = () => cleanup(true);
    document.getElementById('app-confirm-cancel').onclick = () => cleanup(false);
  });
}

function showPlanChoice() {
  let modal = document.getElementById('plan-choice-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'plan-choice-modal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:200; display:flex; align-items:center; justify-content:center; padding:1rem;';
    modal.innerHTML = `
      <div style="background:#f8fafc; border-radius:12px; padding:1.5rem; max-width:680px; width:100%;">
        <h3 style="text-align:center; margin:0 0 1.25rem; color:#0f172a;">Choose your plan</h3>
        <div style="display:flex; gap:1rem; flex-wrap:wrap; justify-content:center;">
          <div style="flex:1; min-width:260px; background:white; border:1px solid #e2e8f0; border-radius:12px; padding:1.5rem;">
            <h3 style="margin:0 0 0.5rem;">Essential</h3>
            <p style="font-size:1.75rem; font-weight:700; margin:0.25rem 0;">£19.95</p>
            <p style="color:#64748b; font-size:0.9rem; margin:0.5rem 0 1rem;">One-off. For one site only.</p>
            <ul style="text-align:left; font-size:0.85rem; color:#475569; padding-left:1.2rem; margin:0 0 1rem;">
              <li>Staff PIN clock in & out</li>
              <li>Timesheets & hours search</li>
              <li>Shop logo & clock style</li>
            </ul>
            <button type="button" id="choose-essential" style="width:100%;">Choose Essential</button>
          </div>
          <div style="flex:1; min-width:260px; background:#0f172a; color:white; border-radius:12px; padding:1.5rem;">
            <h3 style="margin:0 0 0.5rem;">Full</h3>
            <p style="font-size:1.75rem; font-weight:700; margin:0.25rem 0;">£9.95<span style="font-size:1rem; font-weight:400;">/month</span></p>
            <p style="color:#cbd5e1; font-size:0.9rem; margin:0.5rem 0 1rem;">For one site only. Everything in Essential plus:</p>
            <ul style="text-align:left; font-size:0.85rem; color:#e2e8f0; padding-left:1.2rem; margin:0 0 1rem;">
              <li>Weekly schedule</li>
              <li>New starter forms</li>
              <li>Document uploads</li>
              <li>Full employee profiles</li>
            </ul>
            <button type="button" id="choose-full" style="width:100%; background:white; color:#0f172a;">Choose Full</button>
          </div>
        </div>
        <button type="button" id="plan-cancel" style="display:block; margin:1.25rem auto 0; background:transparent; color:#64748b; border:none;">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('choose-essential').onclick = () => {
      window.location.href = 'https://buy.stripe.com/test_cNi14n6N007t62sdmLdfG00';
    };
    document.getElementById('choose-full').onclick = () => {
      window.location.href = 'https://buy.stripe.com/test_9B64gz3AO5rNgH696vdfG01';
    };
    document.getElementById('plan-cancel').onclick = () => modal.style.display = 'none';
  }
  modal.style.display = 'flex';
}

function showPaywall(feature) {
  const priceNote = feature === 'Scheduling'
    ? 'Scheduling is available with a Time Rogue subscription (£9.95 per month).'
    : `${feature} requires a Time Rogue subscription (£9.95 per month).`;

  // Create a simple upgrade modal
  let modal = document.getElementById('paywall-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'paywall-modal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:200; display:flex; align-items:center; justify-content:center; padding:1rem;';
    modal.innerHTML = `
      <div style="background:white; border-radius:12px; padding:1.75rem; max-width:420px; width:100%; text-align:center;">
        <h3 style="margin:0 0 0.75rem; color:#0f172a;">Upgrade to unlock</h3>
        <p id="paywall-message" style="color:#475569; margin:0 0 1.5rem; line-height:1.5;"></p>
        <button id="paywall-upgrade" style="width:100%; margin-bottom:0.5rem;">Upgrade now – £9.95/month</button>
        <button id="paywall-close" type="button" style="width:100%; background:transparent; color:#64748b; border:none;">Not now</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('paywall-close').onclick = () => modal.style.display = 'none';
    document.getElementById('paywall-upgrade').onclick = () => {
      // Replace with your real Stripe subscription Payment Link when ready
      const subUrl = localStorage.getItem('subscription_url') || 'https://buy.stripe.com/test_9B64gz3AO5rNgH696vdfG01';
      window.location.href = subUrl;
    };
  }
  document.getElementById('paywall-message').textContent = priceNote + ' The one-off £19.95 purchase unlocks clock in/out and timesheets.';
  modal.style.display = 'flex';
}

function showAuth() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('auth-screen').classList.add('active');
  updateShopLogo();
}

function showPasswordResetForm() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  let screen = document.getElementById('password-reset-screen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'password-reset-screen';
    screen.className = 'screen';
    screen.innerHTML = `
      <div class="logo"><div class="clock-icon"></div><h1>Set New Password</h1></div>
      <form id="new-password-form" style="max-width:320px; margin:1.5rem auto; display:flex; flex-direction:column; gap:1rem;">
        <input type="password" id="new-password" placeholder="New password (min 8 characters)" minlength="8" required>
        <input type="password" id="confirm-new-password" placeholder="Confirm new password" minlength="8" required>
        <button type="submit">Update Password</button>
        <button type="button" id="cancel-reset">Cancel</button>
      </form>
      <p id="reset-status" style="text-align:center; margin-top:1rem;"></p>
    `;
    document.getElementById('app').appendChild(screen);
    document.getElementById('new-password-form').onsubmit = updatePasswordFromReset;
    document.getElementById('cancel-reset').onclick = () => {
      db.auth.signOut();
      showAuth();
    };
  }
  screen.classList.add('active');
}

async function updatePasswordFromReset(e) {
  e.preventDefault();
  const pw = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-new-password').value;
  const status = document.getElementById('reset-status');
  if (pw.length < 8) {
    status.textContent = 'Password must be at least 8 characters';
    status.style.color = '#dc2626';
    return;
  }
  if (pw !== confirm) {
    status.textContent = 'Passwords do not match';
    status.style.color = '#dc2626';
    return;
  }
  const { error } = await db.auth.updateUser({ password: pw });
  if (error) {
    status.textContent = error.message;
    status.style.color = '#dc2626';
    return;
  }
  status.textContent = 'Password updated! Redirecting…';
  status.style.color = '#16a34a';
  setTimeout(() => {
    showKiosk();
  }, 1200);
}

function showKiosk() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('kiosk-screen').classList.add('active');
  showPin();
  updateShopLogo();
}

function showAdminPassword() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('admin-password-screen').classList.add('active');
  const pwInput = document.getElementById('admin-password');
  if (pwInput) {
    pwInput.value = '';
    pwInput.minLength = 8;
    pwInput.placeholder = 'Admin password (min 8 characters)';
  }
}

function checkAdminPassword(e) {
  e.preventDefault();
  const pw = document.getElementById('admin-password').value;
  if (pw.length < 8) {
    return alert('Password must be at least 8 characters');
  }
  if (pw === ADMIN_PASSWORD) {
    showAdmin();
  } else {
    alert('Incorrect password');
  }
}

function showAdmin() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('admin-screen').classList.add('active');
  loadStaff();
  updateShopLogo();
}

function showMemberLogin() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('member-login-screen').classList.add('active');
  document.getElementById('member-email').value = '';
  document.getElementById('member-password').value = '';
}

async function memberLogin(e) {
  e.preventDefault();
  const email = document.getElementById('member-email').value;
  const password = document.getElementById('member-password').value;
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  const { data: staff } = await db.from('staff').select('*').eq('email', email).eq('owner_id', currentUser.id).maybeSingle();
  if (!staff) return alert('No staff profile found for this email');
  showMemberPortal(staff);
}

function showMemberPortal(staff) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('member-screen').classList.add('active');
  const content = document.getElementById('member-content');
  let formSection = '';
  if (!staff.starter_form_completed) {
    const [first = '', ...rest] = (staff.name || '').split(' ');
    const last = rest.join(' ');
    const data = staff.starter_form_data || {};
    formSection = `
      <h3 style="margin-top:1.5rem;">New Starter Details Form</h3>
      <p style="color:#64748b; font-size:0.9rem;">All sections are required. Complete and submit before your first shift.</p>
      <form id="starter-form" style="display:flex; flex-direction:column; gap:1.25rem; max-width:560px; text-align:left;">
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">Agreed details</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; padding:0.75rem 0;">
            <label>Agreed start date (DD/MM/YYYY)<br><input type="date" id="sf-start-date" value="${data.agreed_start_date || ''}" required style="width:100%;"></label>
            <label>Agreed pay rate (£ per hour)<br><input type="number" id="sf-pay-rate" step="0.01" min="0" value="${data.agreed_pay_rate || ''}" required style="width:100%;"></label>
          </div>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">1. You</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; padding:0.75rem 0;">
            <label>First name<br><input type="text" id="sf-first" value="${data.first_name || first}" required style="width:100%;"></label>
            <label>Last name<br><input type="text" id="sf-last" value="${data.last_name || last}" required style="width:100%;"></label>
            <label>Preferred name (if different)<br><input type="text" id="sf-preferred" value="${data.preferred_name || ''}" style="width:100%;"></label>
            <label>Date of birth (DD/MM/YYYY)<br><input type="date" id="sf-dob" value="${data.dob || staff.dob || ''}" required style="width:100%;"></label>
            <label>Mobile<br><input type="tel" id="sf-mobile" value="${data.mobile || staff.phone || ''}" required style="width:100%;"></label>
            <label>Email<br><input type="email" id="sf-email" value="${data.email || staff.email || ''}" required style="width:100%;"></label>
            <label style="grid-column:1 / -1;">Home address<br><textarea id="sf-address" required style="width:100%; min-height:60px;">${data.home_address || staff.address || ''}</textarea></label>
            <label>Town / city<br><input type="text" id="sf-town" value="${data.town || ''}" required style="width:100%;"></label>
            <label>Postcode<br><input type="text" id="sf-postcode" value="${data.postcode || ''}" required style="width:100%;"></label>
          </div>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">2. Emergency contact</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; padding:0.75rem 0;">
            <label>Name<br><input type="text" id="sf-em-name" value="${data.emergency_name || staff.emergency_contact || ''}" required style="width:100%;"></label>
            <label>Relationship<br><input type="text" id="sf-em-rel" value="${data.emergency_relationship || ''}" required style="width:100%;"></label>
            <label>Phone<br><input type="tel" id="sf-em-phone" value="${data.emergency_phone || staff.emergency_phone || ''}" required style="width:100%;"></label>
          </div>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">3. Pay (so we can pay you)</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.75rem; padding:0.75rem 0;">
            <label>Account holder name<br><input type="text" id="sf-bank-name" value="${data.bank_account_name || staff.bank_account_name || ''}" required style="width:100%;"></label>
            <label>Sort code<br><input type="text" id="sf-sort" value="${data.bank_sort_code || staff.bank_sort_code || ''}" placeholder="00-00-00" required style="width:100%;"></label>
            <label>Account number<br><input type="text" id="sf-acc" value="${data.bank_account_number || staff.bank_account_number || ''}" required style="width:100%;"></label>
            <label>National Insurance number<br><input type="text" id="sf-ni" value="${data.ni_number || staff.ni_number || ''}" required style="width:100%;"></label>
            <label>Student loan to repay?<br>
              <select id="sf-student-loan" required style="width:100%;">
                <option value="">Select</option>
                <option value="yes" ${data.student_loan === 'yes' ? 'selected' : ''}>Yes</option>
                <option value="no" ${data.student_loan === 'no' ? 'selected' : ''}>No</option>
              </select>
            </label>
          </div>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">5. Previous employment & P45 (HMRC)</h4>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; padding:0.75rem 0;">
            <label style="grid-column:1 / -1;">Have you been employed before?<br>
              <select id="sf-prev-employed" required style="width:100%;">
                <option value="">Select</option>
                <option value="yes" ${data.previously_employed === 'yes' ? 'selected' : ''}>Yes</option>
                <option value="no" ${data.previously_employed === 'no' ? 'selected' : ''}>No</option>
              </select>
            </label>
            <label style="grid-column:1 / -1;">Do you have a P45 from your previous employer?<br>
              <select id="sf-has-p45" required style="width:100%;">
                <option value="">Select</option>
                <option value="yes" ${data.has_p45 === 'yes' ? 'selected' : ''}>Yes</option>
                <option value="no" ${data.has_p45 === 'no' ? 'selected' : ''}>No</option>
              </select>
            </label>
            <label style="grid-column:1 / -1;">If yes, upload your P45 (PDF or photo)<br>
              <input type="file" id="sf-p45-file" accept=".pdf,image/*" style="width:100%;">
            </label>
            <label style="grid-column:1 / -1;">If no P45, please tick the statement that applies (HMRC starter checklist):<br>
              <select id="sf-p45-statement" style="width:100%;">
                <option value="">Select if no P45</option>
                <option value="A" ${data.p45_statement === 'A' ? 'selected' : ''}>A – This is my first job since 6 April and I have not been receiving taxable Jobseeker’s Allowance, Employment and Support Allowance, taxable Incapacity Benefit, State or Occupational Pension.</option>
                <option value="B" ${data.p45_statement === 'B' ? 'selected' : ''}>B – This is now my only job, but since 6 April I have had another job, or received taxable Jobseeker’s Allowance, Employment and Support Allowance or taxable Incapacity Benefit. I do not receive a State or Occupational Pension.</option>
                <option value="C" ${data.p45_statement === 'C' ? 'selected' : ''}>C – I have another job or receive a State or Occupational Pension.</option>
              </select>
            </label>
            <label style="grid-column:1 / -1;">Upload photo ID (passport or UK driving licence)<br>
              <input type="file" id="sf-id-file" accept=".pdf,image/*" style="width:100%;">
            </label>
          </div>
        </div>
        <div>
          <p style="margin:0.5rem 0; font-size:0.9rem;">Bring original documents or a share code on or before day one. Tick what you will use:</p>
          <label><input type="checkbox" id="sf-rtw-passport" ${data.rtw_passport ? 'checked' : ''}> UK / Irish passport</label><br>
          <label><input type="checkbox" id="sf-rtw-share" ${data.rtw_share_code ? 'checked' : ''}> Home Office share code</label><br>
          <label><input type="checkbox" id="sf-rtw-other" ${data.rtw_other ? 'checked' : ''}> Other accepted document</label><br>
          <label style="margin-top:0.5rem; display:block;">Share code (if you have one)<br><input type="text" id="sf-share-code" value="${data.share_code || ''}" style="width:100%;"></label>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">5. Work and availability</h4>
          <label>Days you can usually work<br><input type="text" id="sf-days" value="${data.days_available || ''}" required style="width:100%;"></label>
          <label style="margin-top:0.5rem; display:block;">Do you have another job? If yes, where and which days?<br><textarea id="sf-other-job" style="width:100%; min-height:50px;">${data.other_job || ''}</textarea></label>
          <label style="margin-top:0.5rem; display:block;"><input type="checkbox" id="sf-hygiene-yes" ${data.hygiene_level2 ? 'checked' : ''}> I already hold Level 2 Food Hygiene</label>
          <label><input type="checkbox" id="sf-hygiene-no" ${data.hygiene_will_complete ? 'checked' : ''}> I do not — I will complete it within 2 weeks</label>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">6. Health note for food handling (optional)</h4>
          <textarea id="sf-health" style="width:100%; min-height:60px;">${data.health_note || ''}</textarea>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">7. Photos and video at work</h4>
          <p style="margin:0.5rem 0; font-size:0.9rem;">The shop photographs and films the workplace for social media and promotion. Staff may appear.</p>
          <label><input type="checkbox" id="sf-photos" required ${data.photos_consent ? 'checked' : ''}> I understand I may appear in workplace photos and video used to promote the shop</label>
        </div>
        <div>
          <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">8. Confirm</h4>
          <label><input type="checkbox" id="sf-true" required ${data.confirm_true ? 'checked' : ''}> The details on this form are true</label><br>
          <label><input type="checkbox" id="sf-contract" required ${data.confirm_contract ? 'checked' : ''}> I understand I will be sent a contract to read and must confirm it before I start</label><br>
          <label><input type="checkbox" id="sf-phones" required ${data.confirm_phones ? 'checked' : ''}> I understand there are no personal phones on the shop floor</label><br>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:0.75rem;">
            <label>Full name (acts as your signature)<br><input type="text" id="sf-signature" value="${data.signature_name || ''}" required style="width:100%;"></label>
            <label>Date<br><input type="date" id="sf-sig-date" value="${data.signature_date || ''}" required style="width:100%;"></label>
          </div>
        </div>
        <button type="submit" style="margin-top:0.5rem;">Submit Form</button>
      </form>
    `;
  } else {
    formSection = `<p style="margin-top:1.5rem; color:#16a34a; font-weight:600;">Your starter form has been submitted and locked.</p>
      <p style="color:#64748b;">Contact your manager if you need to update any details.</p>`;
  }
  content.innerHTML = `
    <h2>${staff.name}</h2>
    ${formSection}
    <h3 style="margin-top:2rem;">Notifications</h3>
    <label style="display:flex; align-items:center; gap:0.5rem; margin:0.4rem 0;">
      <input type="checkbox" id="notify-holiday-result"> Holiday approvals and rejections
    </label>
    <label style="display:flex; align-items:center; gap:0.5rem; margin:0.4rem 0 0.75rem;">
      <input type="checkbox" id="notify-shift-start"> Shift start reminders
    </label>
    <button type="button" id="save-member-notifications">Save</button>
    <h3 style="margin-top:2rem;">My Shifts</h3>
    <div id="member-shifts" style="margin-top:0.5rem;">Loading...</div>
    <h3 style="margin-top:2rem;">My Hours</h3>
    <div id="member-hours" style="margin-top:0.5rem;">Loading...</div>
    <button onclick="showKiosk()" style="margin-top:1.5rem;">Back to Kiosk</button>
  `;
  if (!staff.starter_form_completed) {
    document.getElementById('starter-form').onsubmit = (e) => submitStarterForm(e, staff.id);
  }
  loadMemberShifts(staff.name);
  loadMemberHours(staff.id);
  document.getElementById('save-member-notifications').onclick = async () => {
    const holiday = document.getElementById('notify-holiday-result').checked;
    const shift = document.getElementById('notify-shift-start').checked;
    await db.from('staff').update({
      notify_holiday_result: holiday,
      notify_shift_start: shift
    }).eq('id', staff.id);
    if ((holiday || shift) && window.OneSignal) {
      await OneSignal.Notifications.requestPermission();
    }
    alert('Notification preferences saved');
  };
}

async function loadMemberShifts(staffName) {
  const el = document.getElementById('member-shifts');
  if (!el) return;
  const { data: published } = await db.from('published_weeks')
    .select('week_start')
    .eq('owner_id', currentUser.id)
    .order('week_start', { ascending: false })
    .limit(4);
  if (!published?.length) {
    el.innerHTML = '<p>No published timetable yet.</p>';
    return;
  }
  let html = '';
  for (const p of published) {
    const start = parseLocalDate(p.week_start);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startStr = toDateString(start);
    const endStr = toDateString(end);
    const { data: shifts } = await db.from('schedules')
      .select('*')
      .eq('owner_id', currentUser.id)
      .eq('name', staffName)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date');
    html += `<div style="margin-bottom:1.5rem; padding:0.75rem; background:#f8fafc; border-radius:8px;">
      <strong>${formatDate(start)} – ${formatDate(end)}</strong>
      <table style="width:100%; margin-top:0.5rem; border-collapse:collapse;">`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateStr = toDateString(d);
      const shift = (shifts || []).find(s => s.date === dateStr);
      const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      html += `<tr>
        <td style="padding:0.4rem 0; border-bottom:1px solid #e2e8f0;">${label}</td>
        <td style="padding:0.4rem 0; border-bottom:1px solid #e2e8f0; text-align:right;">${shift?.start_time || shift?.end_time ? (shift.start_time || '') + ' – ' + (shift.end_time || '') : 'Off'}</td>
      </tr>`;
    }
    html += '</table></div>';
  }
  el.innerHTML = html;
}

async function loadMemberHours(staffId) {
  const { data: clocks } = await db.from('clocks')
    .select('*')
    .eq('staff_id', staffId)
    .order('timestamp', { ascending: false })
    .limit(100);
  const el = document.getElementById('member-hours');
  if (!el) return;
  if (!clocks?.length) {
    el.innerHTML = '<p>No hours recorded yet.</p>';
    return;
  }
  const byDate = {};
  clocks.forEach(c => {
    const date = new Date(c.timestamp).toISOString().slice(0,10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(c);
  });
  let html = '<table style="border-collapse:collapse; width:100%; background:white;"><thead><tr><th style="border:1px solid #e2e8f0; padding:0.4rem;">Date</th><th style="border:1px solid #e2e8f0; padding:0.4rem;">Hours</th></tr></thead><tbody>';
  let grand = 0;
  Object.keys(byDate).sort().reverse().forEach(date => {
    const hrs = calculateHours(byDate[date]);
    grand += hrs;
    html += `<tr><td style="border:1px solid #e2e8f0; padding:0.4rem;">${new Date(date).toLocaleDateString('en-GB')}</td><td style="border:1px solid #e2e8f0; padding:0.4rem; text-align:center;">${hrs.toFixed(1)}</td></tr>`;
  });
  html += `<tr style="font-weight:600;"><td style="border:1px solid #e2e8f0; padding:0.4rem;">Total</td><td style="border:1px solid #e2e8f0; padding:0.4rem; text-align:center;">${grand.toFixed(1)}</td></tr></tbody></table>`;
  el.innerHTML = html;
}

async function submitStarterForm(e, staffId) {
  e.preventDefault();
  if (!(await appConfirm('Confirm all info is correct as this can\'t be undone. Submit now?'))) return;
  const formData = {
    agreed_start_date: document.getElementById('sf-start-date').value,
    agreed_pay_rate: document.getElementById('sf-pay-rate').value,
    first_name: document.getElementById('sf-first').value.trim(),
    last_name: document.getElementById('sf-last').value.trim(),
    preferred_name: document.getElementById('sf-preferred').value.trim(),
    dob: document.getElementById('sf-dob').value,
    mobile: document.getElementById('sf-mobile').value.trim(),
    email: document.getElementById('sf-email').value.trim(),
    home_address: document.getElementById('sf-address').value.trim(),
    town: document.getElementById('sf-town').value.trim(),
    postcode: document.getElementById('sf-postcode').value.trim(),
    emergency_name: document.getElementById('sf-em-name').value.trim(),
    emergency_relationship: document.getElementById('sf-em-rel').value.trim(),
    emergency_phone: document.getElementById('sf-em-phone').value.trim(),
    bank_account_name: document.getElementById('sf-bank-name').value.trim(),
    bank_sort_code: document.getElementById('sf-sort').value.trim(),
    bank_account_number: document.getElementById('sf-acc').value.trim(),
    ni_number: document.getElementById('sf-ni').value.trim(),
    student_loan: document.getElementById('sf-student-loan').value,
    rtw_passport: document.getElementById('sf-rtw-passport').checked,
    rtw_share_code: document.getElementById('sf-rtw-share').checked,
    rtw_other: document.getElementById('sf-rtw-other').checked,
    share_code: document.getElementById('sf-share-code').value.trim(),
    days_available: document.getElementById('sf-days').value.trim(),
    other_job: document.getElementById('sf-other-job').value.trim(),
    hygiene_level2: document.getElementById('sf-hygiene-yes').checked,
    hygiene_will_complete: document.getElementById('sf-hygiene-no').checked,
    health_note: document.getElementById('sf-health').value.trim(),
    photos_consent: document.getElementById('sf-photos').checked,
    confirm_true: document.getElementById('sf-true').checked,
    confirm_contract: document.getElementById('sf-contract').checked,
    confirm_phones: document.getElementById('sf-phones').checked,
    signature_name: document.getElementById('sf-signature').value.trim(),
    signature_date: document.getElementById('sf-sig-date').value,
    previously_employed: document.getElementById('sf-prev-employed')?.value || '',
    has_p45: document.getElementById('sf-has-p45')?.value || '',
    p45_statement: document.getElementById('sf-p45-statement')?.value || '',
    p45_filename: document.getElementById('sf-p45-file')?.files[0]?.name || '',
    id_filename: document.getElementById('sf-id-file')?.files[0]?.name || ''
  };
  if (!formData.rtw_passport && !formData.rtw_share_code && !formData.rtw_other) {
    return alert('Please tick at least one right-to-work option');
  }
  if (!formData.hygiene_level2 && !formData.hygiene_will_complete) {
    return alert('Please tick one food hygiene option');
  }
  const updates = {
    name: `${formData.first_name} ${formData.last_name}`,
    dob: formData.dob || null,
    address: formData.home_address,
    phone: formData.mobile,
    email: formData.email,
    ni_number: formData.ni_number,
    emergency_contact: formData.emergency_name,
    emergency_phone: formData.emergency_phone,
    bank_account_name: formData.bank_account_name,
    bank_sort_code: formData.bank_sort_code,
    bank_account_number: formData.bank_account_number,
    hourly_rate: parseFloat(formData.agreed_pay_rate) || 0,
    starter_form_completed: true,
    starter_form_data: formData,
    starter_form_completed_at: new Date().toISOString()
  };
  const { error } = await db.from('staff').update(updates).eq('id', staffId);
  if (error) return alert(error.message);
  alert('Form submitted and locked. Thank you!');
  showMemberPortal({ ...updates, id: staffId, name: updates.name });
}

function showPin() {
  document.getElementById('pin-section').style.display = 'block';
  document.getElementById('welcome-section').style.display = 'none';
  currentPin = '';
  currentStaff = null;
  updatePinDots();
}

async function login(e) {
  if (e) e.preventDefault();
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');
  const submitBtn = document.querySelector('#auth-form button[type="submit"], #auth-form button:not([type])');
  const email = emailEl?.value?.trim();
  const password = passwordEl?.value;

  if (!email || !password) {
    alert('Please enter both email and password');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.textContent;
    submitBtn.textContent = 'Signing in…';
  }

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      alert(error.message || 'Login failed');
      return;
    }
    currentUser = data.user;
    await refreshPaidStatus();
    showKiosk();
  } catch (err) {
    console.error('Login error:', err);
    alert('Login failed. Please check your connection and try again.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText || 'Log in';
    }
  }
}

async function signup() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert('Enter email and password');
  const { error } = await db.auth.signUp({ email, password });
  if (error) return alert(error.message);
  alert('Account created! Check your email to confirm, then log in.');
}

function showKioskLoginPanel() {
  document.getElementById('kiosk-login-panel').style.display = 'block';
  document.getElementById('kiosk-code-input').value = '';
  document.getElementById('kiosk-login-status').textContent = '';
  document.getElementById('kiosk-code-input').focus();
}

function hideKioskLoginPanel() {
  document.getElementById('kiosk-login-panel').style.display = 'none';
}

async function kioskLoginWithCode() {
  const code = document.getElementById('kiosk-code-input').value.trim();
  const status = document.getElementById('kiosk-login-status');
  if (code.length < 4) {
    status.textContent = 'Enter the kiosk code';
    status.style.color = '#dc2626';
    return;
  }
  status.textContent = 'Checking…';
  status.style.color = '#64748b';

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/kiosk-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      status.textContent = data.error || 'Invalid kiosk code';
      status.style.color = '#dc2626';
      return;
    }
    // Set the session returned by the function
    const { error } = await db.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token
    });
    if (error) {
      status.textContent = error.message;
      status.style.color = '#dc2626';
      return;
    }
    currentUser = data.user;
    await refreshPaidStatus();
    showKiosk();
  } catch (err) {
    status.textContent = 'Could not connect. Try again.';
    status.style.color = '#dc2626';
  }
}

async function forgotPassword() {
  const email = document.getElementById('email').value;
  if (!email) return alert('Enter your email first');
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  if (error) return alert(error.message);
  alert('Password reset email sent. Check your inbox.');
}

function handleKey(d) {
  if (d === 'C') currentPin = '';
  else if (d === '\u2713') { validatePin(); return; }
  else if (currentPin.length < 4) currentPin += d;
  updatePinDots();
}

async function validatePin() {
  if (currentPin.length !== 4 || !currentUser) return;
  const { data: staff, error } = await db.from('staff')
    .select('*')
    .eq('pin', currentPin)
    .eq('owner_id', currentUser.id)
    .single();
  if (error || !staff) {
    showStatus('Invalid PIN', 'error');
    currentPin = '';
    updatePinDots();
    return;
  }
  currentStaff = staff;
  document.getElementById('pin-section').style.display = 'none';
  document.getElementById('welcome-section').style.display = 'block';
  document.getElementById('welcome-message').textContent = `Welcome, ${staff.name}`;
  showActions();
}

async function showActions() {
  const { data: last } = await db.from('clocks')
    .select('type')
    .eq('staff_id', currentStaff.id)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  const buttons = document.getElementById('action-buttons');
  buttons.innerHTML = '';
  const actions = [
    { type: 'in', label: 'Clock In', cls: 'clock-in', show: !last || last.type === 'out' },
    { type: 'break_start', label: 'Start Break', cls: 'start-break', show: last && last.type === 'in' },
    { type: 'break_end', label: 'End Break', cls: 'end-break', show: last && last.type === 'break_start' },
    { type: 'out', label: 'Clock Out', cls: 'clock-out', show: last && (last.type === 'in' || last.type === 'break_end') }
  ];
  actions.filter(a => a.show).forEach(a => {
    const btn = document.createElement('button');
    btn.className = `action-btn ${a.cls}`;
    btn.textContent = a.label;
    btn.onclick = () => recordAction(a.type);
    buttons.appendChild(btn);
  });
}

async function recordAction(type) {
  const { error } = await db.from('clocks').insert({
    owner_id: currentUser.id,
    staff_id: currentStaff.id,
    type,
    timestamp: new Date().toISOString()
  });
  if (error) return showStatus('Error recording', 'error');
  showStatus(`${currentStaff.name} recorded`);
  setTimeout(showPin, 1500);
}

function showStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status ${type}`;
  setTimeout(() => el.textContent = '', 4000);
}

async function updateShopLogo() {
  if (!currentUser) return;
  const { data: profile } = await db.from('profiles').select('logo_url').eq('id', currentUser.id).single();
  const logoUrl = profile?.logo_url;
  document.querySelectorAll('.shop-logo-placeholder').forEach(el => {
    if (logoUrl) {
      const h = el.classList.contains('auth-shop-logo') ? '96px' : '64px';
      const w = el.classList.contains('auth-shop-logo') ? '280px' : '180px';
      el.innerHTML = `<img src="${logoUrl}" alt="Shop logo" style="height:${h}; width:${w}; object-fit:contain; object-position:center;">`;
      el.style.background = 'transparent';
      el.style.width = w;
      el.style.height = h;
    } else {
      el.textContent = 'Shop';
      el.style.background = '#f59e0b';
      el.style.width = el.classList.contains('auth-shop-logo') ? '280px' : '180px';
      el.style.height = el.classList.contains('auth-shop-logo') ? '96px' : '64px';
    }
  });
}

async function applyClockStyle() {
  const el = document.getElementById('current-time');
  if (!el) return;
  const style = localStorage.getItem('clock_style') || 'plain';
  el.classList.remove('clock-flap', 'clock-neon', 'clock-plain');
  el.classList.add('clock-' + style);

  // Update the three static previews if present
  document.querySelectorAll('.clock-preview-item').forEach(p => {
    const s = p.dataset.style;
    if (s) {
      p.classList.remove('clock-flap', 'clock-neon', 'clock-plain');
      p.classList.add('clock-' + s);
    }
  });
}

async function loadHoliday() {
  const tab = document.getElementById('holiday-tab');
  if (!tab) return;
  const { data: staff } = await db.from('staff').select('*').eq('owner_id', currentUser.id).eq('archived', false).order('name');
  let html = '<h3>Holiday</h3><table style="width:100%; border-collapse:collapse; margin-top:1rem;"><thead><tr style="background:#f8fafc;"><th style="text-align:left; padding:0.5rem; border-bottom:1px solid #e2e8f0;">Name</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;">Type</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;">Hours</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;">Accrued</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;">Taken</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;">Remaining</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;">Booked</th><th style="padding:0.5rem; border-bottom:1px solid #e2e8f0;"></th></tr></thead><tbody>';
  for (const s of staff || []) {
    const type = s.worker_type === 'hourly' || s.worker_type === 'irregular' ? 'hourly' : 'salaried';
    const { data: clocks } = await db.from('clocks').select('timestamp').eq('staff_id', s.id);
    const hours = clocks?.length ? (clocks.length * 0.5) : 0;
    const startDate = s.starter_form_data?.agreed_start_date;
    const months = startDate ? Math.max(1, Math.min(12, Math.round((Date.now() - new Date(startDate)) / (1000*60*60*24*30)))) : 12;
    const accrued = type === 'salaried' ? Math.round((months / 12) * 28 * 10) / 10 : Math.round(hours * 0.1207 / 8 * 10) / 10;
    const taken = s.holiday_taken || 0;
    const periods = s.holiday_booked || [];
    let bookedDays = 0;
    periods.forEach(p => {
      if (p.start && p.end) {
        const d1 = new Date(p.start);
        const d2 = new Date(p.end);
        bookedDays += Math.round((d2 - d1) / (1000*60*60*24)) + 1;
      }
    });
    html += `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:0.6rem;">${s.name}</td>
      <td style="padding:0.6rem; text-align:center;">${type}</td>
      <td style="padding:0.6rem; text-align:center;">${hours.toFixed(1)}</td>
      <td style="padding:0.6rem; text-align:center;">${accrued}</td>
      <td style="padding:0.6rem; text-align:center;">${taken}</td>
      <td style="padding:0.6rem; text-align:center;">${Math.max(0, accrued - taken)}</td>
      <td style="padding:0.6rem; text-align:center; ${bookedDays > accrued ? 'color:#dc2626; font-weight:600;' : ''}">${bookedDays}</td>
      <td style="padding:0.6rem; text-align:right;"><button type="button" onclick="openHolidayDetail('${s.id}')">Details</button></td>
    </tr>`;
  }
  html += '</tbody></table><div id="holiday-detail" style="margin-top:1.5rem;"></div>';
  tab.innerHTML = html || '<p>No employees</p>';
}

async function openHolidayDetail(staffId) {
  const { data: s } = await db.from('staff').select('*').eq('id', staffId).single();
  const periods = s.holiday_booked || [];
  document.getElementById('holiday-detail').innerHTML = `
    <h4>${s.name} – Booked periods</h4>
    <div>${periods.map((p, i) => `<div>${p.start} → ${p.end} <button type="button" onclick="removeHolidayPeriod('${s.id}',${i})" style="font-size:0.75rem;">Remove</button></div>`).join('') || '<span style="color:#94a3b8;">None booked</span>'}</div>
    <div style="margin-top:0.5rem; display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
      <input type="date" id="hol-start-${s.id}" style="padding:0.3rem;">
      <input type="date" id="hol-end-${s.id}" style="padding:0.3rem;">
      <button type="button" onclick="addHolidayPeriod('${s.id}')">Add booked period</button>
    </div>
  `;
}
window.openHolidayDetail = openHolidayDetail;

async function addHolidayPeriod(staffId) {
  const start = document.getElementById('hol-start-' + staffId).value;
  const end = document.getElementById('hol-end-' + staffId).value;
  if (!start || !end) return alert('Pick a start and end date');
  const { data: s } = await db.from('staff').select('holiday_booked').eq('id', staffId).single();
  const periods = [...(s.holiday_booked || []), { start, end }];
  await db.from('staff').update({ holiday_booked: periods }).eq('id', staffId);
  loadHoliday();
}
async function removeHolidayPeriod(staffId, index) {
  const { data: s } = await db.from('staff').select('holiday_booked').eq('id', staffId).single();
  const periods = (s.holiday_booked || []).filter((_, i) => i !== index);
  await db.from('staff').update({ holiday_booked: periods }).eq('id', staffId);
  loadHoliday();
}
window.addHolidayPeriod = addHolidayPeriod;
window.removeHolidayPeriod = removeHolidayPeriod;

async function loadStatutory() {
  const tab = document.getElementById('statutory-tab');
  if (!tab) return;
  const { data: docs } = await db.from('statutory_docs').select('*').eq('owner_id', currentUser.id);
  const wop = docs?.find(d => d.doc_type === 'written_statement');
  const handbook = docs?.find(d => d.doc_type === 'handbook');
  const { data: staff } = await db.from('staff').select('id, name, starter_form_completed, statutory_received').eq('owner_id', currentUser.id);
  tab.innerHTML = `
    <h3>Statutory documents</h3>
    <p style="color:#64748b;">Upload once, then attach or email to staff.</p>
    <div style="display:flex; gap:1rem; flex-wrap:wrap; margin:1rem 0;">
      <div style="flex:1; min-width:240px; border:1px solid #e2e8f0; border-radius:8px; padding:1rem;">
        <strong>Written Statement of Particulars</strong>
        <p style="font-size:0.85rem; color:#64748b;">${wop ? 'Uploaded' : 'Not yet uploaded'}</p>
        <input type="file" id="upload-wop" accept=".pdf" style="margin:0.5rem 0;">
        <button type="button" onclick="uploadStatutory('written_statement')">Upload</button>
      </div>
      <div style="flex:1; min-width:240px; border:1px solid #e2e8f0; border-radius:8px; padding:1rem;">
        <strong>Employee Handbook</strong>
        <p style="font-size:0.85rem; color:#64748b;">${handbook ? 'Uploaded' : 'Not yet uploaded'}</p>
        <input type="file" id="upload-handbook" accept=".pdf" style="margin:0.5rem 0;">
        <button type="button" onclick="uploadStatutory('handbook')">Upload</button>
      </div>
    </div>
    <h4>Staff</h4>
    <div id="statutory-staff-list">
      ${(staff || []).map(s => `
        <div style="display:flex; align-items:center; gap:1rem; padding:0.85rem 0.5rem; border-bottom:1px solid #e2e8f0; margin-bottom:0.25rem;">
          <input type="checkbox" class="stat-staff" value="${s.id}" style="width:22px; height:22px; accent-color:#0f172a;">
          <span style="font-size:1rem;">${s.name}</span>
          <span style="margin-left:auto; font-size:0.8rem; color:${s.statutory_received ? '#16a34a' : '#94a3b8'};">
            ${s.statutory_received ? 'Documents received' : '—'}
          </span>
        </div>
      `).join('')}
    </div>
    <div style="margin-top:1rem;">
      <button type="button" onclick="attachStatutory()">Attach to selected profiles</button>
      <button type="button" onclick="emailStatutory()" style="margin-left:0.5rem;">Email to selected</button>
    </div>
  `;
}

async function uploadStatutory(type) {
  const input = document.getElementById(type === 'written_statement' ? 'upload-wop' : 'upload-handbook');
  const file = input?.files[0];
  if (!file) return alert('Choose a PDF first');
  const path = `${currentUser.id}/${type}-${Date.now()}.pdf`;
  const { error } = await db.storage.from('documents').upload(path, file);
  if (error) return alert(error.message);
  await db.from('statutory_docs').upsert({
    owner_id: currentUser.id,
    doc_type: type,
    file_path: path,
    uploaded_at: new Date().toISOString()
  }, { onConflict: 'owner_id,doc_type' });
  alert('Uploaded');
  loadStatutory();
}

async function attachStatutory() {
  const ids = [...document.querySelectorAll('.stat-staff:checked')].map(c => c.value);
  if (!ids.length) return alert('Select at least one staff member');
  await db.from('staff').update({ statutory_received: true, statutory_received_at: new Date().toISOString() }).in('id', ids);
  alert('Marked as received on selected profiles');
  loadStatutory();
}

async function emailStatutory() {
  const ids = [...document.querySelectorAll('.stat-staff:checked')].map(c => c.value);
  if (!ids.length) return alert('Select at least one staff member');
  // Placeholder – real email via Edge Function can be added later
  await db.from('staff').update({ statutory_received: true, statutory_received_at: new Date().toISOString() }).in('id', ids);
  alert('Marked as emailed (confirmation recorded). Actual email sending can be wired to Resend next.');
  loadStatutory();
}

async function loadSettings() {
  const tab = document.getElementById('settings-tab');
  const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
  const currentStyle = localStorage.getItem('clock_style') || 'plain';
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  tab.innerHTML = `
    <h3>Holiday year</h3>
    <label>Starts on (MM-DD)<br>
      <input type="text" id="holiday-year-start" value="${profile?.holiday_year_start || '01-01'}" style="width:120px;">
    </label>
    <button type="button" id="save-holiday-year" style="margin:0.5rem 0 1.5rem;">Save</button>
    <h3>Notifications</h3>
    <label style="display:flex; align-items:center; gap:0.5rem; margin:0.5rem 0;">
      <input type="checkbox" id="notify-clockin" ${profile?.notify_clockin ? 'checked' : ''}>
      Clock-in alerts
    </label>
    <label style="display:flex; align-items:center; gap:0.5rem; margin:0.5rem 0 1rem;">
      <input type="checkbox" id="notify-holiday" ${profile?.notify_holiday_request ? 'checked' : ''}>
      New holiday requests
    </label>
    <button type="button" id="save-notifications">Save notification preferences</button>
    <h3>Clock Style</h3>
    <p>Choose how the time appears on the kiosk screen.</p>
    <div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin:1rem 0 0.5rem;">
      <button type="button" class="clock-style-btn" data-style="plain" style="padding:0.6rem 1rem; background:${currentStyle==='plain'?'#2563eb':'#e2e8f0'}; color:${currentStyle==='plain'?'white':'#0f172a'};">Plain</button>
      <button type="button" class="clock-style-btn" data-style="flap" style="padding:0.6rem 1rem; background:${currentStyle==='flap'?'#2563eb':'#e2e8f0'}; color:${currentStyle==='flap'?'white':'#0f172a'};">Split-flap</button>
      <button type="button" class="clock-style-btn" data-style="neon" style="padding:0.6rem 1rem; background:${currentStyle==='neon'?'#2563eb':'#e2e8f0'}; color:${currentStyle==='neon'?'white':'#0f172a'};">Neon</button>
    </div>
    <div style="margin:0.5rem 0 1.5rem; text-align:center;">
      <p style="font-size:0.85rem; color:#64748b; margin-bottom:0.4rem;">Preview of each style</p>
      <div style="display:flex; justify-content:center; gap:1rem; flex-wrap:wrap;">
        <div class="clock-preview-item clock-plain" data-style="plain">${now}</div>
        <div class="clock-preview-item clock-flap" data-style="flap">${now}</div>
        <div class="clock-preview-item clock-neon" data-style="neon">${now}</div>
      </div>
    </div>

    <h3>Business Logo</h3>
    <p>Upload your logo to appear next to the Time Rogue logo. Max size 2 MB.</p>
    ${profile?.logo_url ? `<img src="${profile.logo_url}" style="height:64px; width:180px; object-fit:contain; margin:1rem 0; border:1px solid #e2e8f0;">` : '<p>No logo uploaded yet.</p>'}
    <form id="logo-form" style="margin-top:1rem;">
      <input type="file" id="logo-file" accept="image/*" required>
      <button type="submit" style="margin-left:0.5rem;">Upload Logo</button>
    </form>

    <h3 style="margin-top:2.5rem;">Kiosk Re-login Code</h3>
    <p>Staff can use this code to log the tablet back into the kiosk without the owner email and password. Choose a code of at least 4 characters.</p>
    <form id="kiosk-code-form" style="display:flex; flex-direction:column; gap:0.5rem; max-width:320px; margin-top:1rem;">
      <input type="text" id="kiosk-code" placeholder="Kiosk code (min 4 characters)" minlength="4" value="${profile?.kiosk_code || ''}" required>
      <button type="submit">Save Kiosk Code</button>
    </form>
    <h3 style="margin-top:2.5rem;">Change Admin Password</h3>
    <p>Minimum 8 characters. This password is used to access the admin area from the kiosk.</p>
    <form id="change-admin-pw" style="display:flex; flex-direction:column; gap:0.5rem; max-width:320px; margin-top:1rem;">
      <input type="password" id="new-admin-pw" placeholder="New password" minlength="8" required>
      <input type="password" id="confirm-admin-pw" placeholder="Confirm password" minlength="8" required>
      <button type="submit">Update Admin Password</button>
    </form>
  `;
  document.getElementById('save-holiday-year').onclick = async () => {
    const val = document.getElementById('holiday-year-start').value.trim() || '01-01';
    const { error } = await db.from('profiles').update({ holiday_year_start: val }).eq('id', currentUser.id);
    if (error) return alert('Could not save: ' + error.message);
    alert('Holiday year start saved');
    loadSettings();
  };
  document.getElementById('save-notifications').onclick = async () => {
    const clockin = document.getElementById('notify-clockin').checked;
    const holiday = document.getElementById('notify-holiday').checked;
    await db.from('profiles').update({
      notify_clockin: clockin,
      notify_holiday_request: holiday
    }).eq('id', currentUser.id);
    if ((clockin || holiday) && window.OneSignal) {
      await OneSignal.Notifications.requestPermission();
    }
    alert('Notification preferences saved');
  };
  document.getElementById('logo-form').onsubmit = uploadLogo;
  document.getElementById('change-admin-pw').onsubmit = changeAdminPassword;
  document.getElementById('kiosk-code-form').onsubmit = saveKioskCode;
  document.querySelectorAll('.clock-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem('clock_style', btn.dataset.style);
      applyClockStyle();
      loadSettings();
    });
  });
  applyClockStyle();
}

async function saveKioskCode(e) {
  e.preventDefault();
  const code = document.getElementById('kiosk-code').value.trim();
  if (code.length < 4) return alert('Code must be at least 4 characters');
  const { error } = await db.from('profiles').update({ kiosk_code: code }).eq('id', currentUser.id);
  if (error) {
    if (error.code === '23505' || /unique|duplicate/i.test(error.message)) {
      return alert('That kiosk code is already in use by another shop. Please choose a different one.');
    }
    return alert(error.message);
  }
  alert('Kiosk code saved. Staff can use this to re-login the tablet.');
}

function changeAdminPassword(e) {
  e.preventDefault();
  const newPw = document.getElementById('new-admin-pw').value;
  const confirmPw = document.getElementById('confirm-admin-pw').value;
  if (newPw.length < 8) return alert('Password must be at least 8 characters');
  if (newPw !== confirmPw) return alert('Passwords do not match');
  ADMIN_PASSWORD = newPw;
  localStorage.setItem('admin_password', newPw);
  alert('Admin password updated');
  document.getElementById('new-admin-pw').value = '';
  document.getElementById('confirm-admin-pw').value = '';
}

async function uploadLogo(e) {
  e.preventDefault();
  const file = document.getElementById('logo-file').files[0];
  if (!file) return;
  if (file.size > MAX_LOGO_SIZE) {
    return alert('Logo must be under 2 MB');
  }
  const path = `${currentUser.id}/logo-${Date.now()}-${file.name}`;
  const { error: upErr } = await db.storage.from('logos').upload(path, file);
  if (upErr) return alert(upErr.message);
  const { data } = db.storage.from('logos').getPublicUrl(path);
  const { error } = await db.from('profiles').update({ logo_url: data.publicUrl }).eq('id', currentUser.id);
  if (error) return alert(error.message);
  alert('Logo uploaded');
  loadSettings();
  updateShopLogo();
}

async function loadStaff() {
  const { data: staff } = await db.from('staff').select('*').eq('owner_id', currentUser.id).eq('archived', false).order('name');
  const tab = document.getElementById('staff-tab');
  tab.innerHTML = `
    <h3>Employees</h3>
    <input type="text" id="staff-search" placeholder="Search employees…" style="width:100%; max-width:400px; margin-bottom:1rem; padding:0.6rem;">
    <button type="button" id="show-add-staff" style="margin-bottom:1rem;">Add Employee</button>
    <form id="add-staff" style="display:none; flex-direction:column; gap:0.5rem; max-width:400px; margin-bottom:1rem;">
      <input type="text" id="staff-first" placeholder="First Name" required>
      <input type="text" id="staff-last" placeholder="Last Name" required>
      <input type="text" id="staff-pin" placeholder="4-digit PIN" maxlength="4" required>
      <button type="submit">Add Employee</button>
      <button type="button" id="cancel-add-staff" style="background:transparent; color:#64748b;">Cancel</button>
    </form>
    <div id="staff-list" style="margin-top:1rem;"></div>
    <button type="button" id="show-archived" style="margin-top:2rem; background:transparent; color:#64748b;">Archived Employees</button>
  `;
  document.getElementById('add-staff').onsubmit = addStaff;
  document.getElementById('show-add-staff').onclick = () => {
    document.getElementById('add-staff').style.display = 'flex';
    document.getElementById('show-add-staff').style.display = 'none';
  };
  document.getElementById('show-archived')?.addEventListener('click', loadArchived);
  document.getElementById('cancel-add-staff').onclick = () => {
    document.getElementById('add-staff').style.display = 'none';
    document.getElementById('show-add-staff').style.display = 'inline-block';
  };
  const list = document.getElementById('staff-list');
  list.innerHTML = staff?.map(s => `
    <div class="staff-item" onclick="openEmployeeProfile('${s.id}')" style="cursor:pointer;">
      ${s.photo_url ? `<img src="${s.photo_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;margin-right:0.5rem;">` : '<div style="width:40px;height:40px;border-radius:50%;background:#e2e8f0;margin-right:0.5rem;"></div>'}
      <span>${s.name}</span>
      ${s.starter_form_completed ? '<span style="color:#16a34a; font-size:0.8rem; margin-left:0.5rem;">Form done</span>' : ''}
      <button onclick="event.stopPropagation(); archiveStaff('${s.id}')">Archive</button>
    </div>
  `).join('') || '<p>No employees yet</p>';
}

async function addStaff(e) {
  e.preventDefault();
  const first = document.getElementById('staff-first').value.trim();
  const last = document.getElementById('staff-last').value.trim();
  const pin = document.getElementById('staff-pin').value;
  const name = `${first} ${last}`;
  const { error } = await db.from('staff').insert({ owner_id: currentUser.id, name, pin });
  if (error) return alert(error.message);
  loadStaff();
}

async function loadArchived() {
  const { data: staff } = await db.from('staff').select('*').eq('owner_id', currentUser.id).eq('archived', true).order('name');
  const tab = document.getElementById('staff-tab');
  tab.innerHTML = `
    <h3>Archived Employees</h3>
    <button type="button" onclick="loadStaff()" style="margin-bottom:1rem;">← Back to employees</button>
    <div id="archived-list">
      ${staff?.map(s => `
        <div class="staff-item" style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem 0;">
          <span>${s.name}</span>
          <button onclick="reinstateStaff('${s.id}')" style="margin-left:auto;">Reinstate</button>
        </div>
      `).join('') || '<p>No archived employees</p>'}
    </div>
  `;
}
async function reinstateStaff(id) {
  await db.from('staff').update({ archived: false }).eq('id', id);
  loadArchived();
}
window.reinstateStaff = reinstateStaff;
window.loadStaff = loadStaff;

async function archiveStaff(id) {
  if (!(await appConfirm('Archive this employee? They will be hidden from the main list but all records are kept.'))) return;
  await db.from('staff').update({ archived: true }).eq('id', id);
  loadStaff();
}
window.archiveStaff = archiveStaff;
async function saveWorkerType(staffId) {
  const type = document.getElementById('worker-type-' + staffId).value;
  await db.from('staff').update({ worker_type: type }).eq('id', staffId);
}
async function saveHourlyRate(staffId) {
  const rate = parseFloat(document.getElementById('edit-rate').value) || 0;
  await db.from('staff').update({ hourly_rate: rate }).eq('id', staffId);
}
window.saveHourlyRate = saveHourlyRate;

async function resetStarterForm(staffId) {
  if (!(await appConfirm('Allow this employee to fill out the starter form again? Previous answers will be kept in the record.'))) return;
  const { error } = await db.from('staff').update({
    starter_form_completed: false
  }).eq('id', staffId);
  if (error) return alert(error.message);
  alert('Form unlocked. Employee can submit a new one.');
  openEmployeeProfile(staffId);
}
window.resetStarterForm = resetStarterForm;

function renderStarterFormMirror(data, completedAt) {
  if (!data) return '<p>No starter form data.</p>';
  const tick = (v) => v ? '\u2713' : '';
  return `
    <div style="border:1px solid #e2e8f0; padding:1rem; margin-top:1rem; background:#fafafa; max-width:600px;">
      <h3 style="margin-top:0;">New Starter Details Form (recorded)</h3>
      <p style="color:#64748b; font-size:0.85rem;">Completed: ${completedAt ? new Date(completedAt).toLocaleString('en-GB') : 'Unknown'}</p>
      <h4>Agreed details</h4>
      <p><strong>Start date:</strong> ${data.agreed_start_date || '—'} &nbsp; <strong>Pay rate:</strong> £${data.agreed_pay_rate || '—'}/hr</p>
      <h4>1. You</h4>
      <p><strong>Name:</strong> ${data.first_name || ''} ${data.last_name || ''} ${data.preferred_name ? '(Preferred: ' + data.preferred_name + ')' : ''}<br>
      <strong>DOB:</strong> ${data.dob || '—'} &nbsp; <strong>Mobile:</strong> ${data.mobile || '—'} &nbsp; <strong>Email:</strong> ${data.email || '—'}<br>
      <strong>Address:</strong> ${data.home_address || '—'}, ${data.town || ''}, ${data.postcode || ''}</p>
      <h4>2. Emergency contact</h4>
      <p><strong>Name:</strong> ${data.emergency_name || '—'} (${data.emergency_relationship || '—'}) &nbsp; <strong>Phone:</strong> ${data.emergency_phone || '—'}</p>
      <h4>3. Pay</h4>
      <p><strong>Account:</strong> ${data.bank_account_name || '—'} &nbsp; <strong>Sort:</strong> ${data.bank_sort_code || '—'} &nbsp; <strong>Acc:</strong> ${data.bank_account_number || '—'}<br>
      <strong>NI:</strong> ${data.ni_number || '—'} &nbsp; <strong>Student loan:</strong> ${data.student_loan || '—'}</p>
      <h4>4. Right to work</h4>
      <p>${tick(data.rtw_passport)} UK/Irish passport &nbsp; ${tick(data.rtw_share_code)} Share code &nbsp; ${tick(data.rtw_other)} Other<br>
      Share code: ${data.share_code || '—'}</p>
      <h4>5. Work and availability</h4>
      <p><strong>Days:</strong> ${data.days_available || '—'}<br>
      <strong>Other job:</strong> ${data.other_job || '—'}<br>
      ${tick(data.hygiene_level2)} Level 2 Food Hygiene &nbsp; ${tick(data.hygiene_will_complete)} Will complete within 2 weeks</p>
      <h4>6. Health note</h4>
      <p>${data.health_note || '—'}</p>
      <h4>7. Photos and video</h4>
      <p>${tick(data.photos_consent)} I understand I may appear in workplace photos and video</p>
      <h4>8. Confirm</h4>
      <p>${tick(data.confirm_true)} Details are true &nbsp; ${tick(data.confirm_contract)} Will confirm contract &nbsp; ${tick(data.confirm_phones)} No personal phones on floor<br>
      <strong>Signature:</strong> ${data.signature_name || '—'} &nbsp; <strong>Date:</strong> ${data.signature_date || '—'}</p>
    </div>
  `;
}

async function openEmployeeProfile(staffId) {
  if (!hasSubscription()) {
    showPaywall('Employee details, starter form and documents');
    return;
  }
  const { data: staff } = await db.from('staff').select('*').eq('id', staffId).single();
  const { data: docs } = await db.from('documents').select('*').eq('staff_id', staffId).order('uploaded_at', { ascending: false });
  const [first = '', ...rest] = (staff.name || '').split(' ');
  const last = rest.join(' ');
  const tab = document.getElementById('staff-tab');

  // Build documents list with signed URLs
  let docsHtml = '<p>No documents</p>';
  if (docs && docs.length) {
    const items = [];
    for (const d of docs) {
      let path = d.file_url;
      // Extract path if a full public URL was stored
      if (path && path.includes('/documents/')) {
        path = path.split('/documents/')[1];
      }
      let url = '#';
      if (path) {
        const { data: signed } = await db.storage.from('documents').createSignedUrl(path, 60 * 60); // 1 hour
        url = signed?.signedUrl || '#';
      }
      items.push(`<div style="margin:0.5rem 0;"><a href="${url}" target="_blank">${d.file_name || d.type}</a> (${d.type})</div>`);
    }
    docsHtml = items.join('');
  }

  tab.innerHTML = `
    <button onclick="loadStaff()" style="margin-bottom:1rem;">← Back to list</button>
    <h2 style="text-align:left; margin:0 0 1.5rem;">${staff.name}</h2>
    ${staff.starter_form_completed ? '<p style="color:#16a34a;">Starter form completed</p>' : '<p style="color:#d97706;">Starter form not yet submitted</p>'}
    ${staff.statutory_received ? '<p style="color:#16a34a;">Statutory documents received</p>' : '<p style="color:#94a3b8;">Statutory documents not yet sent</p>'}
    <label style="display:block; margin:0.75rem 0;">Worker type
      <select id="worker-type-${staffId}" style="margin-left:0.5rem;" onchange="saveWorkerType('${staffId}')">
        <option value="salaried" ${staff.worker_type==='salaried'?'selected':''}>Salaried</option>
        <option value="hourly" ${staff.worker_type==='hourly'||staff.worker_type==='irregular'?'selected':''}>Hourly</option>
      </select>
    </label>
    ${staff.starter_form_completed ? `<button onclick="resetStarterForm('${staffId}')" style="margin-bottom:1rem;">Send another form</button>` : ''}
    <form id="edit-profile" style="text-align:left; display:flex; flex-direction:column; gap:0.75rem; max-width:480px;">
      <label>First Name<br><input type="text" id="edit-first" value="${first}" style="width:100%;"></label>
      <label>Last Name<br><input type="text" id="edit-last" value="${last}" style="width:100%;"></label>
      <label>Date of Birth<br><input type="date" id="edit-dob" value="${staff.dob || ''}" style="width:100%;"></label>
      <label>Address<br><textarea id="edit-address" style="width:100%; min-height:80px;">${staff.address || ''}</textarea></label>
      <label>Email<br><input type="email" id="edit-email" value="${staff.email || ''}" style="width:100%;"></label>
      <label>Hourly Rate (£)<br><input type="number" id="edit-rate" step="0.01" min="0" value="${staff.hourly_rate || 0}" style="width:100%;" onchange="saveHourlyRate('${staffId}')"></label>
      <label>Photo<br><input type="file" id="photo-upload" accept="image/*"></label>
      <button type="submit">Save Details</button>
    </form>
    <button type="button" onclick="sendPasswordInvite('${staff.email || ''}')" style="margin-top:1rem;">Send Invite / Reset Password</button>
    ${staff.starter_form_completed ? renderStarterFormMirror(staff.starter_form_data, staff.starter_form_completed_at) : ''}
    <h4 style="margin-top:2rem;">Documents</h4>
    <div id="docs-list">${docsHtml}</div>
    <form id="upload-doc" style="margin-top:1rem; display:flex; flex-direction:column; gap:0.5rem; max-width:480px;">
      <select id="doc-type"><option value="right_to_work">Right to Work</option><option value="contract">Contract</option><option value="other">Other</option></select>
      <input type="file" id="doc-file" required>
      <button type="submit">Upload Document</button>
    </form>
  `;
  document.getElementById('edit-profile').onsubmit = (e) => saveProfile(e, staffId);
  document.getElementById('upload-doc').onsubmit = (e) => uploadDocument(e, staffId);
}

async function sendPasswordInvite(email) {
  if (!email) return alert('Add an email address first');
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  if (error) return alert(error.message);
  alert('Password setup / reset email sent to ' + email);
}
window.sendPasswordInvite = sendPasswordInvite;

async function saveProfile(e, staffId) {
  e.preventDefault();
  const first = document.getElementById('edit-first').value.trim();
  const last = document.getElementById('edit-last').value.trim();
  const updates = {
    name: `${first} ${last}`,
    dob: document.getElementById('edit-dob').value || null,
    address: document.getElementById('edit-address').value,
    email: document.getElementById('edit-email').value,
    hourly_rate: parseFloat(document.getElementById('edit-rate').value) || 0
  };
  const photoFile = document.getElementById('photo-upload').files[0];
  if (photoFile) {
    const path = `${currentUser.id}/${staffId}/photo-${Date.now()}`;
    const { error: upErr } = await db.storage.from('photos').upload(path, photoFile);
    if (!upErr) {
      const { data } = db.storage.from('photos').getPublicUrl(path);
      updates.photo_url = data.publicUrl;
    }
  }
  const { error } = await db.from('staff').update(updates).eq('id', staffId);
  if (error) return alert(error.message);
  alert('Saved');
  openEmployeeProfile(staffId);
}

async function uploadDocument(e, staffId) {
  e.preventDefault();
  const file = document.getElementById('doc-file').files[0];
  const type = document.getElementById('doc-type').value;
  if (!file) return;
  const path = `${currentUser.id}/${staffId}/${type}-${Date.now()}-${file.name}`;
  const { error: upErr } = await db.storage.from('documents').upload(path, file);
  if (upErr) return alert(upErr.message);
  // Store the storage path (not a public URL) so we can create signed URLs later
  await db.from('documents').insert({
    owner_id: currentUser.id,
    staff_id: staffId,
    type,
    file_url: path,
    file_name: file.name
  });
  openEmployeeProfile(staffId);
}

async function showEmployeeProfile(staffId) {
  const { data: staff } = await db.from('staff').select('*').eq('id', staffId).single();
  const { data: clocks } = await db.from('clocks').select('*').eq('staff_id', staffId).order('timestamp', { ascending: false });
  const hours = calculateHours(clocks || []);
  alert(`${staff.name}\nTotal hours logged: ${hours.toFixed(2)}\n\n(Full document upload available in admin for now)`);
}

function calculateHours(entries) {
  let total = 0;
  let lastIn = null;
  entries.forEach(e => {
    const ts = new Date(e.timestamp);
    if (e.type === 'in' || e.type === 'break_end') lastIn = ts;
    else if ((e.type === 'out' || e.type === 'break_start') && lastIn) {
      total += (ts - lastIn) / (1000 * 60 * 60);
      lastIn = null;
    }
  });
  return total;
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

function getWeekRange(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + (offsetWeeks * 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function toDateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDateRange() {
  if (selectedRange === 'this-week') return getWeekRange(0);
  if (selectedRange === 'last-week') return getWeekRange(-1);
  if (selectedRange === 'custom') {
    const from = document.getElementById('date-from')?.value;
    const to = document.getElementById('date-to')?.value;
    if (!from || !to) return null;
    const start = parseLocalDate(from); start.setHours(0,0,0,0);
    const end = parseLocalDate(to); end.setHours(23,59,59,999);
    return { start, end };
  }
  return null;
}

function updateRangeDisplay() {
  const display = document.getElementById('range-display');
  if (!display) return;
  const range = getDateRange();
  if (range) {
    display.textContent = `${formatDate(range.start)} – ${formatDate(range.end)}`;
  } else {
    display.textContent = selectedRange === 'custom' ? 'Select start and end dates' : '';
  }
}

async function loadTimesheets() {
  const tab = document.getElementById('timesheets-tab');
  tab.innerHTML = `
    <h3>Hours Export</h3>
    <div style="margin-bottom:1rem;">
      <button onclick="setRange('this-week')">This Week</button>
      <button onclick="setRange('last-week')">Last Week</button>
      <button onclick="setRange('custom')">Custom</button>
      <div id="range-display" style="margin:0.75rem 0; font-weight:600; color:#2563eb;"></div>
      <div id="custom-range" style="display:none; margin:0.5rem 0;">
        <label>Start date<br><input type="date" id="date-from" onchange="updateRangeDisplay()"></label>
        <label style="margin-left:1rem;">End date<br><input type="date" id="date-to" onchange="updateRangeDisplay()"></label>
      </div>
      <button onclick="exportHours()" style="margin-top:0.5rem;">Download CSV</button>
    </div>
    <div id="timesheet-summary" style="margin-top:1.5rem;"></div>
  `;
  updateRangeDisplay();
  loadTimesheetSummary();
}

async function loadTimesheetSummary() {
  const range = getDateRange();
  if (!range) return;
  const { data: clocks } = await db.from('clocks')
    .select('*, staff(name, email)')
    .eq('owner_id', currentUser.id)
    .gte('timestamp', range.start.toISOString())
    .lte('timestamp', range.end.toISOString())
    .order('timestamp');
  const { data: staff } = await db.from('staff').select('id, name, email').eq('owner_id', currentUser.id).order('name');
  const summary = document.getElementById('timesheet-summary');
  if (!summary) return;
  if (!clocks?.length) {
    summary.innerHTML = '<p>No clock data in this range.</p>';
    return;
  }
  const byStaff = {};
  (staff || []).forEach(s => byStaff[s.id] = { name: s.name, email: s.email, days: {} });
  clocks.forEach(c => {
    if (!byStaff[c.staff_id]) return;
    const date = new Date(c.timestamp).toISOString().slice(0,10);
    if (!byStaff[c.staff_id].days[date]) byStaff[c.staff_id].days[date] = [];
    byStaff[c.staff_id].days[date].push(c);
  });
  let html = '<h4>Daily Hours Summary</h4><table style="border-collapse:collapse; width:100%; background:white;"><thead><tr><th style="border:1px solid #e2e8f0; padding:0.5rem;">Team Member</th>';
  const dates = [];
  const start = new Date(range.start);
  const end = new Date(range.end);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    dates.push(toDateString(d));
    const dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    html += `<th style="border:1px solid #e2e8f0; padding:0.5rem;">${dayLabel}</th>`;
  }
  html += '<th style="border:1px solid #e2e8f0; padding:0.5rem;">Total</th><th style="border:1px solid #e2e8f0; padding:0.5rem;">Actions</th></tr></thead><tbody>';
  Object.entries(byStaff).forEach(([id, s]) => {
    html += `<tr><td style="border:1px solid #e2e8f0; padding:0.5rem; font-weight:600;">${s.name}</td>`;
    let total = 0;
    dates.forEach(date => {
      const hrs = calculateHours(s.days[date] || []);
      total += hrs;
      html += `<td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">${hrs > 0 ? hrs.toFixed(1) : ''}</td>`;
    });
    html += `<td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center; font-weight:600;">${total.toFixed(1)}</td>`;
    html += `<td style="border:1px solid #e2e8f0; padding:0.25rem; text-align:center;"><button onclick="sendTimesheetToMember('${id}','${s.name}','${s.email || ''}')" style="font-size:0.8rem;">Send to member</button></td></tr>`;
  });
  html += '</tbody></table>';
  summary.innerHTML = html;
}

async function sendTimesheetToMember(staffId, name, email) {
  if (!email) return alert('No email on file for ' + name);
  const range = getDateRange();
  if (!range) return alert('Select a date range first');
  const { data: clocks } = await db.from('clocks')
    .select('*')
    .eq('staff_id', staffId)
    .gte('timestamp', range.start.toISOString())
    .lte('timestamp', range.end.toISOString())
    .order('timestamp');
  const byDate = {};
  (clocks || []).forEach(c => {
    const date = new Date(c.timestamp).toISOString().slice(0,10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(c);
  });
  let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width:480px; margin:0 auto; color:#1e293b;">
    <h1 style="font-size:1.4rem;">Your Hours</h1>
    <p style="color:#64748b;">${formatDate(range.start)} – ${formatDate(range.end)}</p>
    <table style="width:100%; border-collapse:collapse; margin-top:1rem;">`;
  let total = 0;
  Object.keys(byDate).sort().forEach(date => {
    const hrs = calculateHours(byDate[date]);
    total += hrs;
    html += `<tr>
      <td style="padding:0.6rem 0; border-bottom:1px solid #e2e8f0;">${new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</td>
      <td style="padding:0.6rem 0; border-bottom:1px solid #e2e8f0; text-align:right;">${hrs.toFixed(1)} hrs</td>
    </tr>`;
  });
  html += `<tr><td style="padding:0.8rem 0; font-weight:600;">Total</td><td style="padding:0.8rem 0; text-align:right; font-weight:600;">${total.toFixed(1)} hrs</td></tr></table>
  <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">Sent from Time Rogue</p></div>`;
  try {
    await sendEmail(email, `Your hours – ${formatDate(range.start)}`, html);
    alert('Timesheet sent to ' + name);
  } catch (err) {
    alert('Failed to send: ' + (err.message || err));
  }
}
window.sendTimesheetToMember = sendTimesheetToMember;

window.setRange = (r) => {
  selectedRange = r;
  const custom = document.getElementById('custom-range');
  if (custom) custom.style.display = r === 'custom' ? 'block' : 'none';
  updateRangeDisplay();
  loadTimesheetSummary();
};

async function exportHours() {
  const range = getDateRange();
  if (!range) return alert('Please select a valid date range');
  const { data: clocks } = await db.from('clocks')
    .select('*, staff(name)')
    .eq('owner_id', currentUser.id)
    .gte('timestamp', range.start.toISOString())
    .lte('timestamp', range.end.toISOString())
    .order('timestamp');
  if (!clocks?.length) return alert('No data in range');
  const rows = [['Name','Type','Date','Time','Daily Hours']];
  const byStaffDate = {};
  clocks.forEach(c => {
    const date = new Date(c.timestamp).toISOString().slice(0,10);
    const key = `${c.staff?.name}|${date}`;
    if (!byStaffDate[key]) byStaffDate[key] = [];
    byStaffDate[key].push(c);
  });
  clocks.forEach(c => {
    const d = new Date(c.timestamp);
    const dateStr = d.toISOString().slice(0,10);
    const key = `${c.staff?.name}|${dateStr}`;
    const dailyHrs = calculateHours(byStaffDate[key] || []).toFixed(1);
    rows.push([c.staff?.name || '', c.type, d.toLocaleDateString('en-GB'), d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), dailyHrs]);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hours-${selectedRange}.csv`;
  a.click();
}
window.exportHours = exportHours;

function downloadScheduleTemplate() {
  const csv = 'name,date,start_time,end_time\nSarah Williams,2026-10-20,09:00,17:00\n';
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schedule-template.csv';
  a.click();
}
window.downloadScheduleTemplate = downloadScheduleTemplate;

function changeWeek(offset) {
  currentWeekOffset += offset;
  loadSchedule();
}
window.changeWeek = changeWeek;

async function loadSchedule() {
  const week = getWeekRange(currentWeekOffset);
  const dayDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(week.start);
    d.setDate(week.start.getDate() + i);
    dayDates.push(toDateString(d));
  }
  const { data: staff } = await db.from('staff').select('name, email, hourly_rate, holiday_booked').eq('owner_id', currentUser.id).order('name');
  const startDate = toDateString(week.start);
  const endDate = toDateString(week.end);
  const { data: schedules } = await db.from('schedules')
    .select('*')
    .eq('owner_id', currentUser.id)
    .gte('date', startDate)
    .lte('date', endDate);
  const { data: published } = await db.from('published_weeks')
    .select('week_start')
    .eq('owner_id', currentUser.id)
    .eq('week_start', startDate)
    .maybeSingle();
  const tab = document.getElementById('schedule-tab');
  const title = `${formatDate(week.start)} – ${formatDate(week.end)}`;
  const publishBtn = published 
    ? `<button disabled style="background:#94a3b8;">Published</button>` 
    : '';
  let table = `<div style="display:flex; align-items:center; gap:1rem; margin-bottom:1rem;">
      <button onclick="changeWeek(-1)" style="font-size:1.2rem;">←</button>
      <h3 style="margin:0; flex:1; text-align:center;">${title}</h3>
      <button onclick="changeWeek(1)" style="font-size:1.2rem;">→</button>
    </div>
    <div style="margin-bottom:1rem;">${publishBtn}</div>
    <h4 style="margin:0.5rem 0 1rem;">Rota</h4>
    <div style="overflow-x:auto; margin-bottom:1rem;">
      <table style="border-collapse:collapse; width:100%; background:white;">
        <thead><tr>
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:left;">Team Member</th>
          ${dayDates.map(dateStr => {
            const d = parseLocalDate(dateStr);
            const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            return `<th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">${label}</th>`;
          }).join('')}
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">Total Hours</th>
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">Gross Wage</th>
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">Actions</th>
        </tr></thead>
        <tbody>`;
  let grandTotalWage = 0;
  (staff || []).forEach(s => {
    let totalHours = 0;
    table += `<tr data-name="${s.name}" data-rate="${parseFloat(s.hourly_rate) || 0}"><td style="border:1px solid #e2e8f0; padding:0.5rem; font-weight:600;">${s.name}</td>`;
    dayDates.forEach(date => {
      const dayShifts = (schedules || []).filter(sc => sc.name === s.name && sc.date === date);
      const isHoliday = (s.holiday_booked || []).some(p => date >= p.start && date <= p.end);
      table += `<td style="border:1px solid #e2e8f0; padding:0.25rem; text-align:center; ${isHoliday ? 'background:#fef3c7;' : ''}">
        ${isHoliday ? '<div style="font-size:0.7rem; color:#92400e; margin-bottom:2px;">Holiday</div>' : ''}
        <div style="display:flex; gap:4px; justify-content:center; flex-wrap:wrap;">`;
      if (!isHoliday) {
        if (dayShifts.length === 0) dayShifts.push({});
        dayShifts.forEach(shift => {
          const start = shift.start_time || '';
          const end = shift.end_time || '';
          totalHours += hoursBetween(start, end);
          table += `<div class="shift-slot" style="display:inline-block; margin:0 2px;">
            <div style="font-size:0.65rem; color:#94a3b8;">Shift</div>
            <input type="time" class="shift-start" data-date="${date}" value="${start}" style="width:72px; font-size:0.75rem;">
            <br><input type="time" class="shift-end" data-date="${date}" value="${end}" style="width:72px; font-size:0.75rem; margin-top:2px;">
          </div>`;
        });
        table += `</div>
          <button type="button" class="add-shift" data-date="${date}" style="margin-top:4px; padding:0 6px; font-size:0.9rem; line-height:1.2;">+</button>`;
      } else {
        table += `</div>`;
      }
      table += `</td>`;
    });
    const rate = parseFloat(s.hourly_rate) || 0;
    const wage = totalHours * rate;
    grandTotalWage += wage;
    table += `<td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center; font-weight:600;">${totalHours.toFixed(1)}</td>`;
    table += `<td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">£${wage.toFixed(2)}</td>`;
    table += `<td style="border:1px solid #e2e8f0; padding:0.25rem; text-align:center;"><button onclick="sendShiftsToMember('${s.name}','${s.email || ''}')" style="font-size:0.8rem; padding:0.3rem 0.5rem;">Send to member</button></td>`;
    table += '</tr>';
  });
  table += `<tr style="background:#f1f5f9; font-weight:700;">
    <td style="border:1px solid #e2e8f0; padding:0.5rem;" colspan="${dayDates.length + 1}">Weekly Total</td>
    <td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;"></td>
    <td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">£${grandTotalWage.toFixed(2)}</td>
    <td></td>
  </tr>`;
  table += '</tbody></table></div>';
  table += `<div style="margin-bottom:1.5rem;">
    <button onclick="saveScheduleTable()" style="background:#0f172a; color:white;">Save Schedule</button>
    <button onclick="sendToAllTeam()" style="margin-left:0.5rem; background:#0f172a; color:white;">Send to member portal</button>
  </div>`;
  table += `<div style="border-top:1px solid #e2e8f0; padding-top:1.5rem;">
    <p>Upload a CSV with columns: name, date (YYYY-MM-DD), start_time, end_time 
    <button onclick="downloadScheduleTemplate()" style="margin-left:0.5rem;">Download template</button></p>
    <input type="file" id="schedule-file" accept=".csv" style="margin:1rem 0;">
    <button onclick="uploadSchedule()">Upload Schedule</button>
  </div>`;
  tab.innerHTML = table;
  tab.querySelectorAll('.add-shift').forEach(btn => {
    btn.onclick = () => {
      const cell = btn.parentElement;
      const slots = cell.querySelectorAll('.shift-slot');
      if (slots.length >= 2) return;
      const date = btn.dataset.date;
      const extra = document.createElement('div');
      extra.className = 'shift-slot';
      extra.style.display = 'inline-block';
      extra.style.marginLeft = '4px';
      extra.innerHTML = `
        <input type="time" class="shift-start" data-date="${date}" style="width:72px; font-size:0.75rem;">
        <br><input type="time" class="shift-end" data-date="${date}" style="width:72px; font-size:0.75rem; margin-top:2px;">
      `;
      const flex = btn.previousElementSibling;
      if (flex) flex.appendChild(extra);
      // auto-save on the new inputs
      extra.querySelectorAll('input').forEach(inp => inp.onchange = () => saveScheduleTable());
    };
  });
  // Auto-save when any existing time changes
  tab.querySelectorAll('.shift-start, .shift-end').forEach(inp => {
    inp.onchange = () => {
      updateScheduleTotals();
      saveScheduleTable();
    };
  });
}

function updateScheduleTotals() {
  const rows = document.querySelectorAll('#schedule-tab tbody tr[data-name]');
  let grand = 0;
  rows.forEach(row => {
    let hours = 0;
    const starts = row.querySelectorAll('.shift-start');
    const ends = row.querySelectorAll('.shift-end');
    starts.forEach((inp, i) => {
      hours += hoursBetween(inp.value, ends[i]?.value);
    });
    const rate = parseFloat(row.dataset.rate) || 0;
    const wage = hours * rate;
    grand += wage;
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      cells[cells.length - 3].textContent = hours.toFixed(1);
      cells[cells.length - 2].textContent = '£' + wage.toFixed(2);
    }
  });
  const totalRow = document.querySelector('#schedule-tab tbody tr:last-child');
  if (totalRow) {
    const tds = totalRow.querySelectorAll('td');
    if (tds.length >= 2) tds[tds.length - 2].textContent = '£' + grand.toFixed(2);
  }
}

async function publishWeek(weekStart) {
  const { error } = await db.from('published_weeks').upsert({
    owner_id: currentUser.id,
    week_start: weekStart,
    published_at: new Date().toISOString()
  }, { onConflict: 'owner_id,week_start' });
  if (error) return alert(error.message);
  alert('Timetable published to member portals');
  loadSchedule();
}
window.publishWeek = publishWeek;

function buildShiftEmailHtml(shifts, weekStart, weekEnd) {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width:480px; margin:0 auto; color:#1e293b;">
    <h1 style="font-size:1.4rem; margin-bottom:0.25rem;">Your Shifts</h1>
    <p style="color:#64748b; margin-top:0;">${formatDate(weekStart)} – ${formatDate(weekEnd)}</p>
    <table style="width:100%; border-collapse:collapse; margin-top:1rem;">`;
  let totalHours = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = toDateString(d);
    const shift = (shifts || []).find(s => s.date === dateStr);
    const dayName = days[i];
    const dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const hrs = hoursBetween(shift?.start_time, shift?.end_time);
    totalHours += hrs;
    html += `<tr>
      <td style="padding:0.75rem 0; border-bottom:1px solid #e2e8f0;">
        <div style="font-size:1.15rem; font-weight:600;">${dayName}</div>
        <div style="font-size:0.9rem; color:#64748b;">${dateLabel}</div>
      </td>
      <td style="padding:0.75rem 0; border-bottom:1px solid #e2e8f0; text-align:right;">
        ${shift?.start_time || shift?.end_time 
          ? `<div style="font-size:1.05rem;">${shift.start_time || ''} – ${shift.end_time || ''}</div>
             <div style="font-size:0.85rem; color:#64748b;">${hrs.toFixed(1)} hrs</div>`
          : '<div style="color:#94a3b8;">Off</div>'}
      </td>
    </tr>`;
  }
  html += `<tr>
    <td style="padding:1rem 0; font-weight:600;">Total</td>
    <td style="padding:1rem 0; text-align:right; font-weight:600;">${totalHours.toFixed(1)} hrs</td>
  </tr></table>
  <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">Sent from Time Rogue</p>
  </div>`;
  return html;
}

async function sendEmail(to, subject, html) {
  const url = 'https://bpljlflxkntyhyoekpkd.supabase.co/functions/v1/Send-Schedule';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || res.statusText || 'Failed to send');
  }
  return data;
}

async function sendShiftsToMember(name, email) {
  if (!email) return alert('No email on file for ' + name);
  const week = getWeekRange(currentWeekOffset);
  const startDate = toDateString(week.start);
  const endDate = toDateString(week.end);
  const { data: schedules } = await db.from('schedules')
    .select('*')
    .eq('owner_id', currentUser.id)
    .eq('name', name)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');
  const html = buildShiftEmailHtml(schedules, week.start, week.end);
  try {
    await sendEmail(email, `Your shifts – ${formatDate(week.start)}`, html);
    alert('Shifts sent to ' + name);
  } catch (err) {
    alert('Failed to send: ' + (err.message || err));
  }
}
window.sendShiftsToMember = sendShiftsToMember;

async function sendToAllTeam() {
  const { data: staff } = await db.from('staff').select('name, email').eq('owner_id', currentUser.id);
  const week = getWeekRange(currentWeekOffset);
  const startDate = toDateString(week.start);
  const endDate = toDateString(week.end);
  const { data: schedules } = await db.from('schedules')
    .select('*')
    .eq('owner_id', currentUser.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');
  let sent = 0;
  for (const s of staff || []) {
    if (!s.email) continue;
    const myShifts = (schedules || []).filter(sc => sc.name === s.name);
    const html = buildShiftEmailHtml(myShifts, week.start, week.end);
    try {
      await sendEmail(s.email, `Your shifts – ${formatDate(week.start)}`, html);
      sent++;
    } catch (err) {
      console.error(err);
    }
  }
  alert(`Sent to ${sent} team members`);
}
window.sendToAllTeam = sendToAllTeam;

async function saveScheduleTable() {
  const week = getWeekRange(currentWeekOffset);
  const rows = document.querySelectorAll('#schedule-tab tbody tr');
  const toInsert = [];
  rows.forEach(row => {
    const name = row.dataset.name;
    if (!name) return;
    row.querySelectorAll('.shift-start').forEach((input, i) => {
      const date = input.dataset.date;
      const start = input.value;
      const end = row.querySelectorAll('.shift-end')[i].value;
      if (start && end && start !== '00:00' && end !== '00:00') {
        toInsert.push({ owner_id: currentUser.id, name, date, start_time: start, end_time: end });
      }
    });
  });
  const startDate = toDateString(week.start);
  const endDate = toDateString(week.end);
  await db.from('schedules').delete().eq('owner_id', currentUser.id).gte('date', startDate).lte('date', endDate);
  if (toInsert.length) {
    const { error } = await db.from('schedules').insert(toInsert);
    if (error) return alert(error.message);
  }
  // auto-saved
}
window.saveScheduleTable = saveScheduleTable;

async function uploadSchedule() {
  const fileInput = document.getElementById('schedule-file');
  const file = fileInput.files[0];
  if (!file) return alert('Choose a CSV file');
  const text = await file.text();
  const lines = text.trim().split('\n').slice(1);
  const rows = lines.map(line => {
    const [name, date, start_time, end_time] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    return { owner_id: currentUser.id, name, date, start_time, end_time };
  }).filter(r => r.name && r.date);
  if (!rows.length) return alert('No valid rows found');
  const { error } = await db.from('schedules').insert(rows);
  if (error) return alert(error.message);
  alert('Schedule uploaded');
  loadSchedule();
}
window.uploadSchedule = uploadSchedule;
