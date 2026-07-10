const CITY_LABELS = { valdivia: 'Valdivia', la_union: 'La Unión' };
const STATUS_LABELS = { available: 'Disponible', blocked: 'Bloqueado', booked: 'Reservado' };

const loginBox = document.getElementById('loginBox');
const adminPanel = document.getElementById('adminPanel');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const loginNote = document.getElementById('loginNote');
const slotForm = document.getElementById('slotForm');
const slotFormNote = document.getElementById('slotFormNote');
const recurringForm = document.getElementById('recurringForm');
const recurringFormNote = document.getElementById('recurringFormNote');
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function buildRecurringSlots({ city, fromDate, toDate, weekdays, startTime, endTime, duration }) {
  const slots = [];
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const dayStartMin = sh * 60 + sm;
  const dayEndMin = eh * 60 + em;

  const cursor = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T00:00:00Z');

  while (cursor <= end) {
    if (weekdays.includes(cursor.getUTCDay())) {
      const dateStr = cursor.toISOString().slice(0, 10);
      for (let t = dayStartMin; t + duration <= dayEndMin; t += duration) {
        const bStart = `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
        const bEnd = `${pad2(Math.floor((t + duration) / 60))}:${pad2((t + duration) % 60)}`;
        slots.push({ city, slot_date: dateStr, start_time: bStart, end_time: bEnd });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

recurringForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  recurringFormNote.textContent = '';
  recurringFormNote.className = 'form-note';

  const formData = new FormData(recurringForm);
  const fromDate = formData.get('from_date');
  const toDate = formData.get('to_date');
  const weekdays = formData.getAll('weekday').map(Number);
  const duration = parseInt(formData.get('duration'), 10);

  if (weekdays.length === 0) {
    recurringFormNote.textContent = 'Selecciona al menos un día de la semana.';
    recurringFormNote.className = 'form-note error';
    return;
  }

  if (toDate < fromDate) {
    recurringFormNote.textContent = 'La fecha "Hasta" debe ser posterior a "Desde".';
    recurringFormNote.className = 'form-note error';
    return;
  }

  const daysInRange = (new Date(toDate) - new Date(fromDate)) / 86400000;
  if (daysInRange > 90) {
    recurringFormNote.textContent = 'El rango es muy grande (máximo 90 días). Achícalo e inténtalo de nuevo.';
    recurringFormNote.className = 'form-note error';
    return;
  }

  const newSlots = buildRecurringSlots({
    city: formData.get('city'),
    fromDate,
    toDate,
    weekdays,
    startTime: formData.get('start_time'),
    endTime: formData.get('end_time'),
    duration
  });

  if (newSlots.length === 0) {
    recurringFormNote.textContent = 'No se generó ningún horario. Revisa que la hora de fin sea mayor que la de inicio.';
    recurringFormNote.className = 'form-note error';
    return;
  }

  const submitBtn = recurringForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  recurringFormNote.textContent = `Creando ${newSlots.length} horarios...`;

  const { error } = await db.from('slots').insert(newSlots);
  submitBtn.disabled = false;

  if (error) {
    recurringFormNote.textContent = error.message.includes('unique_slot')
      ? 'Algunos de esos horarios ya existían (fecha/hora repetida), así que no se creó ninguno. Revisa la tabla de horarios de abajo.'
      : error.message.includes('otra ciudad')
        ? 'Ya existen horarios de otra ciudad en alguna de esas fechas. ' + error.message
        : 'No se pudieron crear los horarios. Revisa los datos.';
    recurringFormNote.className = 'form-note error';
    return;
  }

  recurringFormNote.textContent = `¡Listo! Se crearon ${newSlots.length} horarios.`;
  recurringFormNote.className = 'form-note success';
  recurringForm.reset();
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
