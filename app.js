// Multi-tenant TimeClock app with profiles, documents, and export
let currentPin = '';
let currentStaff = null;
let currentUser = null;
let selectedRange = 'this-week';
let currentWeekOffset = 0;
const ADMIN_PASSWORD = '0506';

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    currentUser = session.user;
    showKiosk();
  } else {
    showAuth();
  }
  setupEventListeners();
  setInterval(updateTime, 1000);
  updateTime();
  updatePinDots();
});

function updateTime() {
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
  document.getElementById('auth-form')?.addEventListener('submit', login);
  document.getElementById('signup-btn')?.addEventListener('click', signup);
  document.getElementById('forgot-btn')?.addEventListener('click', forgotPassword);
  document.getElementById('admin-btn')?.addEventListener('click', showAdminPassword);
  document.getElementById('exit-admin')?.addEventListener('click', showKiosk);
  document.getElementById('back-to-pin')?.addEventListener('click', showPin);
  document.getElementById('member-btn')?.addEventListener('click', showMemberLogin);
  document.getElementById('cancel-admin')?.addEventListener('click', showKiosk);
  document.getElementById('cancel-member')?.addEventListener('click', showKiosk);
  document.getElementById('exit-member')?.addEventListener('click', showKiosk);
  document.getElementById('admin-password-form')?.addEventListener('submit', checkAdminPassword);
  document.getElementById('member-login-form')?.addEventListener('submit', memberLogin);

  const keypad = document.getElementById('keypad');
  if (keypad && !keypad.children.length) {
    ['1','2','3','4','5','6','7','8','9','C','0','✓'].forEach(d => {
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
      document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
      if (tab.dataset.tab === 'timesheets') loadTimesheets();
      if (tab.dataset.tab === 'staff') loadStaff();
      if (tab.dataset.tab === 'schedule') loadSchedule();
      if (tab.dataset.tab === 'settings') loadSettings();
    });
  });
}

function showAuth() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('auth-screen').classList.add('active');
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
  document.getElementById('admin-password').value = '';
}

function checkAdminPassword(e) {
  e.preventDefault();
  const pw = document.getElementById('admin-password').value;
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
  if (staff.starter_form_completed) {
    content.innerHTML = `
      <h2>${staff.name}</h2>
      <p style="margin-top:1.5rem; color:#16a34a; font-weight:600;">Your starter form has been submitted and locked.</p>
      <p style="color:#64748b;">Contact your manager if you need to update any details.</p>
      <button onclick="showKiosk()" style="margin-top:1.5rem;">Back to Kiosk</button>
    `;
    return;
  }
  const [first = '', ...rest] = (staff.name || '').split(' ');
  const last = rest.join(' ');
  const data = staff.starter_form_data || {};
  content.innerHTML = `
    <h2>${staff.name}</h2>
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
        <h4 style="background:#f1f5f9; padding:0.5rem; margin:0;">4. Right to work in the UK</h4>
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
    <button onclick="showKiosk()" style="margin-top:1.5rem;">Back to Kiosk</button>
  `;
  document.getElementById('starter-form').onsubmit = (e) => submitStarterForm(e, staff.id);
}

async function submitStarterForm(e, staffId) {
  e.preventDefault();
  if (!confirm('Confirm all info is correct as this can\'t be undone. Submit now?')) return;
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
    signature_date: document.getElementById('sf-sig-date').value
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
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) return alert(error.message);
  currentUser = data.user;
  showKiosk();
}

async function signup() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert('Enter email and password');
  const { error } = await db.auth.signUp({ email, password });
  if (error) return alert(error.message);
  alert('Account created! Check your email to confirm, then log in.');
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
  else if (d === '✓') { validatePin(); return; }
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
      el.innerHTML = `<img src="${logoUrl}" alt="Shop logo" style="max-height:36px; max-width:100px; object-fit:contain;">`;
      el.style.background = 'transparent';
    } else {
      el.textContent = 'Shop';
    }
  });
}

async function loadSettings() {
  const tab = document.getElementById('settings-tab');
  const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
  tab.innerHTML = `
    <h3>Business Logo</h3>
    <p>Upload your logo to appear next to the TimeClock logo.</p>
    ${profile?.logo_url ? `<img src="${profile.logo_url}" style="max-height:60px; margin:1rem 0;">` : '<p>No logo uploaded yet.</p>'}
    <form id="logo-form" style="margin-top:1rem;">
      <input type="file" id="logo-file" accept="image/*" required>
      <button type="submit" style="margin-left:0.5rem;">Upload Logo</button>
    </form>
    <p style="margin-top:1rem; font-size:0.85rem; color:#64748b;">If upload fails, create a public bucket named <strong>photos</strong> in Supabase Storage.</p>
  `;
  document.getElementById('logo-form').onsubmit = uploadLogo;
}

async function uploadLogo(e) {
  e.preventDefault();
  const file = document.getElementById('logo-file').files[0];
  if (!file) return;
  const path = `${currentUser.id}/logo-${Date.now()}-${file.name}`;
  const { error: upErr } = await db.storage.from('photos').upload(path, file);
  if (upErr) return alert(upErr.message + ' — Create a public bucket named "photos" in Supabase Storage if it does not exist.');
  const { data } = db.storage.from('photos').getPublicUrl(path);
  const { error } = await db.from('profiles').update({ logo_url: data.publicUrl }).eq('id', currentUser.id);
  if (error) return alert(error.message);
  alert('Logo uploaded');
  loadSettings();
  updateShopLogo();
}

async function loadStaff() {
  const { data: staff } = await db.from('staff').select('*').eq('owner_id', currentUser.id).order('name');
  const tab = document.getElementById('staff-tab');
  tab.innerHTML = `
    <h3>Employees</h3>
    <form id="add-staff" style="display:flex; flex-direction:column; gap:0.5rem; max-width:400px;">
      <input type="text" id="staff-first" placeholder="First Name" required>
      <input type="text" id="staff-last" placeholder="Last Name" required>
      <input type="text" id="staff-pin" placeholder="4-digit PIN" maxlength="4" required>
      <button type="submit">Add Employee</button>
    </form>
    <div id="staff-list" style="margin-top:1rem;"></div>
  `;
  document.getElementById('add-staff').onsubmit = addStaff;
  const list = document.getElementById('staff-list');
  list.innerHTML = staff?.map(s => `
    <div class="staff-item" onclick="openEmployeeProfile('${s.id}')" style="cursor:pointer;">
      ${s.photo_url ? `<img src="${s.photo_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;margin-right:0.5rem;">` : '<div style="width:40px;height:40px;border-radius:50%;background:#e2e8f0;margin-right:0.5rem;"></div>'}
      <span>${s.name}</span>
      ${s.starter_form_completed ? '<span style="color:#16a34a; font-size:0.8rem; margin-left:0.5rem;">Form done</span>' : ''}
      <button onclick="event.stopPropagation(); deleteStaff('${s.id}')">Delete</button>
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

async function deleteStaff(id) {
  if (!confirm('Delete this employee?')) return;
  await db.from('staff').delete().eq('id', id);
  loadStaff();
}
window.deleteStaff = deleteStaff;
window.openEmployeeProfile = openEmployeeProfile;

async function resetStarterForm(staffId) {
  if (!confirm('Allow this employee to fill out the starter form again? Previous answers will be kept in the record.')) return;
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
  const tick = (v) => v ? '✓' : '';
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
  const { data: staff } = await db.from('staff').select('*').eq('id', staffId).single();
  const { data: docs } = await db.from('documents').select('*').eq('staff_id', staffId).order('uploaded_at', { ascending: false });
  const [first = '', ...rest] = (staff.name || '').split(' ');
  const last = rest.join(' ');
  const tab = document.getElementById('staff-tab');
  tab.innerHTML = `
    <button onclick="loadStaff()" style="margin-bottom:1rem;">← Back to list</button>
    <h2 style="text-align:left; margin:0 0 1.5rem;">${staff.name}</h2>
    ${staff.starter_form_completed ? '<p style="color:#16a34a;">Starter form completed</p>' : '<p style="color:#d97706;">Starter form not yet submitted</p>'}
    ${staff.starter_form_completed ? `<button onclick="resetStarterForm('${staffId}')" style="margin-bottom:1rem;">Send another form</button>` : ''}
    <form id="edit-profile" style="text-align:left; display:flex; flex-direction:column; gap:0.75rem; max-width:480px;">
      <label>First Name<br><input type="text" id="edit-first" value="${first}" style="width:100%;"></label>
      <label>Last Name<br><input type="text" id="edit-last" value="${last}" style="width:100%;"></label>
      <label>Date of Birth<br><input type="date" id="edit-dob" value="${staff.dob || ''}" style="width:100%;"></label>
      <label>Address<br><textarea id="edit-address" style="width:100%; min-height:80px;">${staff.address || ''}</textarea></label>
      <label>Email<br><input type="email" id="edit-email" value="${staff.email || ''}" style="width:100%;"></label>
      <label>Hourly Rate (£)<br><input type="number" id="edit-rate" step="0.01" min="0" value="${staff.hourly_rate || 0}" style="width:100%;"></label>
      <label>Photo<br><input type="file" id="photo-upload" accept="image/*"></label>
      <button type="submit">Save Details</button>
    </form>
    <button type="button" onclick="sendPasswordInvite('${staff.email || ''}')" style="margin-top:1rem;">Send Invite / Reset Password</button>
    ${staff.starter_form_completed ? renderStarterFormMirror(staff.starter_form_data, staff.starter_form_completed_at) : ''}
    <h4 style="margin-top:2rem;">Documents</h4>
    <div id="docs-list">${docs?.map(d => `<div style="margin:0.5rem 0;"><a href="${d.file_url}" target="_blank">${d.file_name || d.type}</a> (${d.type})</div>`).join('') || '<p>No documents</p>'}</div>
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
  const { data } = db.storage.from('documents').getPublicUrl(path);
  await db.from('documents').insert({
    owner_id: currentUser.id,
    staff_id: staffId,
    type,
    file_url: data.publicUrl,
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
    const start = new Date(from); start.setHours(0,0,0,0);
    const end = new Date(to); end.setHours(23,59,59,999);
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
    .select('*, staff(name)')
    .eq('owner_id', currentUser.id)
    .gte('timestamp', range.start.toISOString())
    .lte('timestamp', range.end.toISOString())
    .order('timestamp');
  const { data: staff } = await db.from('staff').select('id, name').eq('owner_id', currentUser.id).order('name');
  const summary = document.getElementById('timesheet-summary');
  if (!summary) return;
  if (!clocks?.length) {
    summary.innerHTML = '<p>No clock data in this range.</p>';
    return;
  }
  const byStaff = {};
  (staff || []).forEach(s => byStaff[s.id] = { name: s.name, days: {} });
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
    dates.push(d.toISOString().slice(0,10));
    html += `<th style="border:1px solid #e2e8f0; padding:0.5rem;">${d.toLocaleDateString('en-GB', {day:'numeric', month:'short'})}</th>`;
  }
  html += '<th style="border:1px solid #e2e8f0; padding:0.5rem;">Total</th></tr></thead><tbody>';
  Object.values(byStaff).forEach(s => {
    html += `<tr><td style="border:1px solid #e2e8f0; padding:0.5rem; font-weight:600;">${s.name}</td>`;
    let total = 0;
    dates.forEach(date => {
      const hrs = calculateHours(s.days[date] || []);
      total += hrs;
      html += `<td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">${hrs > 0 ? hrs.toFixed(1) : ''}</td>`;
    });
    html += `<td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center; font-weight:600;">${total.toFixed(1)}</td></tr>`;
  });
  html += '</tbody></table>';
  summary.innerHTML = html;
}

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
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(week.start);
    d.setDate(week.start.getDate() + i);
    dayDates.push(d.toISOString().slice(0,10));
  }
  const { data: staff } = await db.from('staff').select('name, email, hourly_rate').eq('owner_id', currentUser.id).order('name');
  const startDate = week.start.toISOString().slice(0,10);
  const endDate = week.end.toISOString().slice(0,10);
  const { data: schedules } = await db.from('schedules')
    .select('*')
    .eq('owner_id', currentUser.id)
    .gte('date', startDate)
    .lte('date', endDate);
  const tab = document.getElementById('schedule-tab');
  const title = `${formatDate(week.start)} – ${formatDate(week.end)}`;
  let table = `<div style="display:flex; align-items:center; gap:1rem; margin-bottom:1rem;">
      <button onclick="changeWeek(-1)" style="font-size:1.2rem;">←</button>
      <h3 style="margin:0; flex:1; text-align:center;">${title}</h3>
      <button onclick="changeWeek(1)" style="font-size:1.2rem;">→</button>
    </div>
    <div style="overflow-x:auto; margin-bottom:1rem;">
      <table style="border-collapse:collapse; width:100%; background:white;">
        <thead><tr>
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:left;">Team Member</th>
          ${days.map(d => `<th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">${d}</th>`).join('')}
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">Total Hours</th>
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">Gross Wage</th>
          <th style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">Actions</th>
        </tr></thead>
        <tbody>`;
  let grandTotalWage = 0;
  (staff || []).forEach(s => {
    let totalHours = 0;
    table += `<tr data-name="${s.name}"><td style="border:1px solid #e2e8f0; padding:0.5rem; font-weight:600;">${s.name}</td>`;
    dayDates.forEach(date => {
      const shift = (schedules || []).find(sc => sc.name === s.name && sc.date === date);
      const start = shift?.start_time || '';
      const end = shift?.end_time || '';
      totalHours += hoursBetween(start, end);
      table += `<td style="border:1px solid #e2e8f0; padding:0.25rem; text-align:center;">
        <input type="time" class="shift-start" data-date="${date}" value="${start}" style="width:70px; font-size:0.8rem;">
        <br><input type="time" class="shift-end" data-date="${date}" value="${end}" style="width:70px; font-size:0.8rem; margin-top:2px;">
      </td>`;
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
    <td style="border:1px solid #e2e8f0; padding:0.5rem;" colspan="${days.length + 1}">Weekly Total</td>
    <td style="border:1px solid #e2e8f0; padding:0.5rem; text-align:center;">£${grandTotalWage.toFixed(2)}</td>
    <td></td>
  </tr>`;
  table += '</tbody></table></div>';
  table += `<div style="margin-bottom:1.5rem;">
    <button onclick="saveScheduleTable()" style="background:#16a34a;">Save Timetable</button>
    <button onclick="sendToAllTeam()" style="margin-left:0.5rem;">Send to all team</button>
  </div>`;
  table += `<div style="border-top:1px solid #e2e8f0; padding-top:1.5rem;">
    <p>Upload a CSV with columns: name, date (YYYY-MM-DD), start_time, end_time 
    <button onclick="downloadScheduleTemplate()" style="margin-left:0.5rem;">Download template</button></p>
    <input type="file" id="schedule-file" accept=".csv" style="margin:1rem 0;">
    <button onclick="uploadSchedule()">Upload Schedule</button>
  </div>`;
  tab.innerHTML = table;
}

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
    const dateStr = d.toISOString().slice(0,10);
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
  <p style="color:#94a3b8; font-size:0.85rem; margin-top:1.5rem;">Sent from TimeClock</p>
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
  const startDate = week.start.toISOString().slice(0,10);
  const endDate = week.end.toISOString().slice(0,10);
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
  const startDate = week.start.toISOString().slice(0,10);
  const endDate = week.end.toISOString().slice(0,10);
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
      if (start || end) {
        toInsert.push({ owner_id: currentUser.id, name, date, start_time: start, end_time: end });
      }
    });
  });
  const startDate = week.start.toISOString().slice(0,10);
  const endDate = week.end.toISOString().slice(0,10);
  await db.from('schedules').delete().eq('owner_id', currentUser.id).gte('date', startDate).lte('date', endDate);
  if (toInsert.length) {
    const { error } = await db.from('schedules').insert(toInsert);
    if (error) return alert(error.message);
  }
  alert('Timetable saved');
  loadSchedule();
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
