const CITY_LABELS_HOME = { valdivia: 'Valdivia', la_union: 'La Unión' };
const DIAS_HOME = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_HOME = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function loadNextSlot() {
  const teaser = document.getElementById('nextSlotTeaser');
  const text = document.getElementById('nextSlotText');
  if (!teaser || !text || typeof db === 'undefined') return;

  const { data, error } = await db
    .from('slots')
    .select('city, slot_date, start_time')
    .eq('status', 'available')
    .gte('slot_date', new Date().toISOString().slice(0, 10))
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return;

  const slot = data[0];
  const d = new Date(slot.slot_date + 'T00:00:00Z');
  const fecha = `${DIAS_HOME[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_HOME[d.getUTCMonth()]}`;
  const hora = slot.start_time.slice(0, 5);

  text.textContent = `Próxima hora disponible: ${CITY_LABELS_HOME[slot.city]} — ${fecha}, ${hora}`;
  teaser.style.display = 'inline-flex';
}

loadNextSlot();
