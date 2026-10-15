// Multi-tenant TimeClock app
let currentPin = '';
let currentStaff = null;
let currentUser = null;

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

  // Build keypad
  const keypad = document.getElementById('keypad');
  if (keypad) {
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
  if (d === 'C') {
    currentPin = '';
  } else if (d === '✓') {
    validatePin();
    return;
  } else if (currentPin.length < 4) {
    currentPin += d;
  }
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
    <h3>Staff</h3>
    <form id="add-staff">
      <input type="text" id="staff-name" placeholder="Name" required>
      <input type="text" id="staff-pin" placeholder="4-digit PIN" maxlength="4" required>
      <button type="submit">Add</button>
    </form>
    <div id="staff-list"></div>
  `;
  document.getElementById('add-staff').onsubmit = addStaff;
  const list = document.getElementById('staff-list');
  list.innerHTML = staff?.map(s => `<div class="staff-item"><span>${s.name} (${s.pin})</span><button onclick="deleteStaff('${s.id}')">Delete</button></div>`).join('') || '<p>No staff yet</p>';
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
  if (!confirm('Delete?')) return;
  await db.from('staff').delete().eq('id', id);
  loadStaff();
}
window.deleteStaff = deleteStaff;
