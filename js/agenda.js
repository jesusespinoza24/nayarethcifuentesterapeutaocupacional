const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function formatDateHeading(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

function formatTime(t) {
  return t.slice(0, 5);
}

let currentCity = 'valdivia';
let selectedSlot = null;

const slotsContainer = document.getElementById('slotsContainer');
const cityTabs = document.getElementById('cityTabs');
const modal = document.getElementById('bookingModal');
const modalSummary = document.getElementById('modalSlotSummary');
const modalNote = document.getElementById('modalNote');
const bookingForm = document.getElementById('bookingForm');

cityTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  cityTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCity = btn.dataset.city;
  loadSlots();
});

async function loadSlots() {
  slotsContainer.innerHTML = '<p class="empty-state">Cargando horarios disponibles…</p>';

  const { data, error } = await db
    .from('slots')
    .select('id, slot_date, start_time, end_time')
    .eq('city', currentCity)
    .eq('status', 'available')
    .gte('slot_date', new Date().toISOString().slice(0, 10))
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    slotsContainer.innerHTML = '<p class="empty-state">No se pudieron cargar los horarios. Intenta recargar la página.</p>';
    return;
  }

  if (!data || data.length === 0) {
    slotsContainer.innerHTML = '<p class="empty-state">No hay horarios disponibles por ahora en esta ciudad. Escríbeme por WhatsApp y coordinamos directamente.</p>';
    return;
  }

  const byDate = {};
  data.forEach(slot => {
    (byDate[slot.slot_date] = byDate[slot.slot_date] || []).push(slot);
  });

  slotsContainer.innerHTML = Object.keys(byDate).map(date => `
    <div class="slot-day-group">
      <h3 class="slot-day-heading">${formatDateHeading(date)}</h3>
      <div class="slot-grid">
        ${byDate[date].map(slot => `
          <button type="button" class="slot-card" data-id="${slot.id}" data-summary="${formatDateHeading(date)}, ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}">
            ${formatTime(slot.start_time)}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

slotsContainer.addEventListener('click', (e) => {
  const card = e.target.closest('.slot-card');
  if (!card) return;
  selectedSlot = card.dataset.id;
  modalSummary.textContent = card.dataset.summary;
  modalNote.textContent = '';
  modalNote.className = 'form-note';
  bookingForm.reset();
  modal.style.display = 'flex';
});

document.getElementById('modalCancel').addEventListener('click', () => {
  modal.style.display = 'none';
  selectedSlot = null;
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.style.display = 'none';
    selectedSlot = null;
  }
});

bookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedSlot) return;

  const formData = new FormData(bookingForm);
  const submitBtn = bookingForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  modalNote.textContent = 'Confirmando...';
  modalNote.className = 'form-note';

  const { error } = await db.rpc('book_slot', {
    p_slot_id: selectedSlot,
    p_name: formData.get('nombre'),
    p_phone: formData.get('telefono'),
    p_comuna: formData.get('comuna'),
    p_reason: formData.get('motivo') || null
  });

  submitBtn.disabled = false;

  if (error) {
    modalNote.textContent = error.message.includes('SLOT_NOT_AVAILABLE')
      ? 'Este horario ya fue reservado por otra persona. Elige otro horario disponible.'
      : 'Ocurrió un error al confirmar. Intenta nuevamente o escríbeme por WhatsApp.';
    modalNote.className = 'form-note error';
    return;
  }

  modalNote.textContent = '¡Listo! Tu hora quedó agendada. Te contactaré por WhatsApp para coordinar la dirección.';
  modalNote.className = 'form-note success';
  setTimeout(() => {
    modal.style.display = 'none';
    selectedSlot = null;
    loadSlots();
  }, 2200);
});

loadSlots();
