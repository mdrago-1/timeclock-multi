// Multi-tenant TimeClock app with profiles, documents, and export
let currentPin = '';
let currentStaff = null;
let currentUser = null;
let selectedRange = 'this-week';

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
});

function updateTime() {
  const el = document.getElementById('current-time');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setupEventListeners() {
  document.getElementById('auth-form')?.addEventListener('submit', login);
  document.getElementById('signup-btn')?.addEventListener('click', signup);
  document.getElementById('forgot-btn')?.addEventListener('click', forgotPassword);
  document.getElementById('admin-btn')?.addEventListener('click', showAdmin);
  document.getElementById('exit-admin')?.addEventListener('click', showKiosk);
  document.getElementById('back-to-pin')?.addEventListener('click', showPin);

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
    });
  });
}

function showAuth() {
  document.getElementById('auth-screen').classList.add('active');
  document.getElementById('kiosk-screen').classList.remove('active');
  document.getElementById('admin-screen').classList.remove('active');
}

function showKiosk() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('kiosk-screen').classList.add('active');
  document.getElementById('admin-screen').classList.remove('active');
  showPin();
}

function showAdmin() {
  document.getElementById('kiosk-screen').classList.remove('active');
  document.getElementById('admin-screen').classList.add('active');
  loadStaff();
}

function showPin() {
  document.getElementById('pin-section').style.display = 'block';
  document.getElementById('welcome-section').style.display = 'none';
  currentPin = '';
  currentStaff = null;
  document.getElementById('pin-display').textContent = 'Enter PIN';
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
  document.getElementById('pin-display').textContent = currentPin.padEnd(4, '•').split('').join(' ') || 'Enter PIN';
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
    document.getElementById('pin-display').textContent = 'Enter PIN';
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
    { type: 'in', label: 'Clock In', show: !last || last.type === 'out' },
    { type: 'break_start', label: 'Start Break', show: last && last.type === 'in' },
    { type: 'break_end', label: 'End Break', show: last && last.type === 'break_start' },
    { type: 'out', label: 'Clock Out', show: last && (last.type === 'in' || last.type === 'break_end') }
  ];
  actions.filter(a => a.show).forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = a.label;
    btn.onclick = () => recordAction(a.type);
    buttons.appendChild(btn);
  });
  const profileBtn = document.createElement('button');
  profileBtn.className = 'action-btn';
  profileBtn.textContent = 'My Profile & Hours';
  profileBtn.onclick = () => showEmployeeProfile(currentStaff.id);
  buttons.appendChild(profileBtn);
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

async function loadStaff() {
  const { data: staff } = await db.from('staff').select('*').eq('owner_id', currentUser.id).order('name');
  const tab = document.getElementById('staff-tab');
  tab.innerHTML = `
    <h3>Employees</h3>
    <form id="add-staff">
      <input type="text" id="staff-name" placeholder="Full Name" required>
      <input type="text" id="staff-pin" placeholder="4-digit PIN" maxlength="4" required>
      <button type="submit">Add Employee</button>
    </form>
    <div id="staff-list"></div>
  `;
  document.getElementById('add-staff').onsubmit = addStaff;
  const list = document.getElementById('staff-list');
  list.innerHTML = staff?.map(s => `
    <div class="staff-item" onclick="openEmployeeProfile('${s.id}')" style="cursor:pointer;">
      ${s.photo_url ? `<img src="${s.photo_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;margin-right:0.5rem;">` : '<div style="width:40px;height:40px;border-radius:50%;background:#e2e8f0;margin-right:0.5rem;"></div>'}
      <span>${s.name}</span>
      <button onclick="event.stopPropagation(); deleteStaff('${s.id}')">Delete</button>
    </div>
  `).join('') || '<p>No employees yet</p>';
}

async function addStaff(e) {
  e.preventDefault();
  const name = document.getElementById('staff-name').value;
  const pin = document.getElementById('staff-pin').value;
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

async function openEmployeeProfile(staffId) {
  const { data: staff } = await db.from('staff').select('*').eq('id', staffId).single();
  const { data: docs } = await db.from('documents').select('*').eq('staff_id', staffId).order('uploaded_at', { ascending: false });
  const tab = document.getElementById('staff-tab');
  tab.innerHTML = `
    <button onclick="loadStaff()">← Back to list</button>
    <h3>${staff.name}</h3>
    <form id="edit-profile">
      <label>Name <input type="text" id="edit-name" value="${staff.name || ''}"></label><br>
      <label>Date of Birth <input type="date" id="edit-dob" value="${staff.dob || ''}"></label><br>
      <label>Address <textarea id="edit-address">${staff.address || ''}</textarea></label><br>
      <label>Email <input type="email" id="edit-email" value="${staff.email || ''}"></label><br>
      <label>Photo <input type="file" id="photo-upload" accept="image/*"></label><br>
      <button type="submit">Save Details</button>
    </form>
    <h4>Documents</h4>
    <div id="docs-list">${docs?.map(d => `<div><a href="${d.file_url}" target="_blank">${d.file_name || d.type}</a> (${d.type})</div>`).join('') || '<p>No documents</p>'}</div>
    <form id="upload-doc">
      <select id="doc-type"><option value="right_to_work">Right to Work</option><option value="contract">Contract</option><option value="other">Other</option></select>
      <input type="file" id="doc-file" required>
      <button type="submit">Upload Document</button>
    </form>
  `;
  document.getElementById('edit-profile').onsubmit = (e) => saveProfile(e, staffId);
  document.getElementById('upload-doc').onsubmit = (e) => uploadDocument(e, staffId);
}

async function saveProfile(e, staffId) {
  e.preventDefault();
  const updates = {
    name: document.getElementById('edit-name').value,
    dob: document.getElementById('edit-dob').value || null,
    address: document.getElementById('edit-address').value,
    email: document.getElementById('edit-email').value
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
  // Simple employee self-view
  const { data: staff } = await db.from('staff').select('*').eq('id', staffId).single();
  const { data: clocks } = await db.from('clocks').select('*').eq('staff_id', staffId).order('timestamp', { ascending: false });
  const hours = calculateHours(clocks || []);
  alert(`${staff.name}\nTotal hours logged: ${hours.toFixed(2)}\n\n(Full document upload available in admin for now)`);
  // For a fuller view we could open a modal, but this is a start
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

function getDateRange() {
  if (selectedRange === 'this-week') return getWeekRange(0);
  if (selectedRange === 'last-week') return getWeekRange(-1);
  if (selectedRange === 'custom') {
    const from = document.getElementById('date-from')?.value;
    const to = document.getElementById('date-to')?.value;
    if (!from || !to) { alert('Select both dates'); return null; }
    const start = new Date(from); start.setHours(0,0,0,0);
    const end = new Date(to); end.setHours(23,59,59,999);
    return { start, end };
  }
  return null;
}

async function loadTimesheets() {
  const tab = document.getElementById('timesheets-tab');
  tab.innerHTML = `
    <h3>Hours Export</h3>
    <div>
      <button onclick="setRange('this-week')">This Week</button>
      <button onclick="setRange('last-week')">Last Week</button>
      <button onclick="setRange('custom')">Custom</button>
      <div id="custom-range" style="display:none; margin:0.5rem 0;">
        From: <input type="date" id="date-from"> To: <input type="date" id="date-to">
      </div>
      <button onclick="exportHours()">Download CSV</button>
    </div>
    <div id="summary"></div>
  `;
}

window.setRange = (r) => {
  selectedRange = r;
  document.getElementById('custom-range').style.display = r === 'custom' ? 'block' : 'none';
};

async function exportHours() {
  const range = getDateRange();
  if (!range) return;
  const { data: clocks } = await db.from('clocks')
    .select('*, staff(name)')
    .eq('owner_id', currentUser.id)
    .gte('timestamp', range.start.toISOString())
    .lte('timestamp', range.end.toISOString())
    .order('timestamp');
  if (!clocks?.length) return alert('No data in range');
  const rows = [['Name','Type','Date','Time']];
  clocks.forEach(c => {
    const d = new Date(c.timestamp);
    rows.push([c.staff?.name || '', c.type, d.toLocaleDateString('en-GB'), d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})]);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hours-${selectedRange}.csv`;
  a.click();
}
window.exportHours = exportHours;
