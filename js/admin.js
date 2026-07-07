const CITY_LABELS = { valdivia: 'Valdivia', la_union: 'La Unión' };
const STATUS_LABELS = { available: 'Disponible', blocked: 'Bloqueado', booked: 'Reservado' };

const loginBox = document.getElementById('loginBox');
const adminPanel = document.getElementById('adminPanel');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const loginNote = document.getElementById('loginNote');
const slotForm = document.getElementById('slotForm');
const slotFormNote = document.getElementById('slotFormNote');
const slotsTableBody = document.getElementById('slotsTableBody');
const bookingsTableBody = document.getElementById('bookingsTableBody');

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}
function formatTime(t) {
  return t.slice(0, 5);
}

async function showSession(session) {
  if (session) {
    loginBox.style.display = 'none';
    adminPanel.classList.add('visible');
    logoutBtn.style.display = 'inline-flex';
    await loadSlots();
    await loadBookings();
  } else {
    loginBox.style.display = 'block';
    adminPanel.classList.remove('visible');
    logoutBtn.style.display = 'none';
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginNote.textContent = '';
  const formData = new FormData(loginForm);
  const { data, error } = await db.auth.signInWithPassword({
    email: formData.get('email'),
    password: formData.get('password')
  });
  if (error) {
    loginNote.textContent = 'Correo o contraseña incorrectos.';
    return;
  }
  showSession(data.session);
});

logoutBtn.addEventListener('click', async () => {
  await db.auth.signOut();
  showSession(null);
});

slotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  slotFormNote.textContent = '';
  const formData = new FormData(slotForm);

  const { error } = await db.from('slots').insert({
    city: formData.get('city'),
    slot_date: formData.get('slot_date'),
    start_time: formData.get('start_time'),
    end_time: formData.get('end_time')
  });

  if (error) {
    slotFormNote.textContent = error.message.includes('unique_slot')
      ? 'Ya existe un horario igual para esa ciudad, fecha y hora.'
      : error.message.includes('otra ciudad')
        ? error.message
        : 'No se pudo crear el horario. Revisa los datos.';
    return;
  }

  slotForm.reset();
  await loadSlots();
});

async function loadSlots() {
  const { data, error } = await db
    .from('slots')
    .select('id, city, slot_date, start_time, end_time, status')
    .gte('slot_date', new Date().toISOString().slice(0, 10))
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    slotsTableBody.innerHTML = '<tr><td colspan="5">Error al cargar horarios.</td></tr>';
    return;
  }

  if (!data || data.length === 0) {
    slotsTableBody.innerHTML = '<tr><td colspan="5">Sin horarios creados todavía.</td></tr>';
    return;
  }

  slotsTableBody.innerHTML = data.map(slot => `
    <tr>
      <td>${CITY_LABELS[slot.city]}</td>
      <td>${formatDate(slot.slot_date)}</td>
      <td>${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}</td>
      <td><span class="status-badge ${slot.status}">${STATUS_LABELS[slot.status]}</span></td>
      <td>
        ${slot.status !== 'booked'
          ? `<button type="button" class="btn-small toggle-slot" data-id="${slot.id}" data-status="${slot.status}">
              ${slot.status === 'available' ? 'Bloquear' : 'Habilitar'}
            </button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

slotsTableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('.toggle-slot');
  if (!btn) return;
  const newStatus = btn.dataset.status === 'available' ? 'blocked' : 'available';
  await db.from('slots').update({ status: newStatus }).eq('id', btn.dataset.id);
  await loadSlots();
});

async function loadBookings() {
  const { data, error } = await db
    .from('bookings')
    .select('id, client_name, client_phone, client_comuna, reason, created_at, slot:slots(city, slot_date, start_time, end_time)')
    .order('created_at', { ascending: false });

  if (error) {
    bookingsTableBody.innerHTML = '<tr><td colspan="6">Error al cargar reservas.</td></tr>';
    return;
  }

  if (!data || data.length === 0) {
    bookingsTableBody.innerHTML = '<tr><td colspan="6">Sin reservas todavía.</td></tr>';
    return;
  }

  bookingsTableBody.innerHTML = data.map(b => `
    <tr>
      <td>${b.slot ? `${formatDate(b.slot.slot_date)} ${formatTime(b.slot.start_time)}` : '-'}</td>
      <td>${b.slot ? CITY_LABELS[b.slot.city] : '-'}</td>
      <td>${b.client_name}</td>
      <td>${b.client_phone}</td>
      <td>${b.client_comuna}</td>
      <td>${b.reason || '-'}</td>
    </tr>
  `).join('');
}

db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((_event, session) => showSession(session));
