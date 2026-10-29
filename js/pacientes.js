const AREAS = {
  motricidad_fina: { label: 'Motricidad fina', color: '#4361ee' },
  avd: { label: 'Vida diaria (AVD)', color: '#e8590c' },
  motricidad_gruesa: { label: 'Motricidad gruesa', color: '#0f9d8a' },
  sensorial: { label: 'Procesamiento sensorial', color: '#c2255c' },
  cognicion_juego: { label: 'Cognición y juego', color: '#7048e8' },
  social_conducta: { label: 'Social y conducta', color: '#b08800' }
};
const PATIENT_STATUS_LABELS = { activo: 'Activo', pausa: 'En pausa', alta: 'Alta' };
const GOAL_STATUS_LABELS = { pendiente: 'Pendiente', en_progreso: 'En progreso', logrado: 'Logrado' };
const GOAL_STATUS_ORDER = { en_progreso: 0, pendiente: 1, logrado: 2 };
const AVATAR_COLORS = ['#4361ee', '#e8590c', '#0f9d8a', '#c2255c', '#7048e8', '#b08800'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const $ = (id) => document.getElementById(id);

const loginView = $('loginView');
const appView = $('appView');
const headerActions = $('headerActions');
const loginForm = $('loginForm');
const loginNote = $('loginNote');
const loginBtn = $('loginBtn');
const patientList = $('patientList');
const patientSearch = $('patientSearch');
const detailEmpty = $('detailEmpty');
const detailContent = $('detailContent');
const goalList = $('goalList');
const sessionList = $('sessionList');
const tooltip = $('chartTooltip');

let patients = [];
let currentPatient = null;
let goals = [];
let progressRows = [];
let sessions = [];
let statusFilter = 'activo';
let editingPatientId = null;
let editingGoalId = null;
let editingSessionId = null;
let progressGoalId = null;

// ── Utilidades ─────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function ageLabel(birthDate) {
  if (!birthDate) return '';
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months--;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} ${rest === 1 ? 'mes' : 'meses'}`;
  const yearsText = `${years} ${years === 1 ? 'año' : 'años'}`;
  return rest ? `${yearsText} ${rest} ${rest === 1 ? 'mes' : 'meses'}` : yearsText;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function avatarColor(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function emptyToNull(value) {
  const text = (value ?? '').toString().trim();
  return text === '' ? null : text;
}

function showError(noteEl, error) {
  noteEl.textContent = 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.';
  console.error(error);
}

// ── Sesión ─────────────────────────────────────────────────────────────
async function showSession(session) {
  loginView.hidden = !!session;
  appView.hidden = !session;
  headerActions.hidden = !session;
  if (session) {
    await loadPatients();
    await loadStats();
  } else {
    currentPatient = null;
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginNote.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Entrando…';
  const formData = new FormData(loginForm);
  const { data, error } = await db.auth.signInWithPassword({
    email: formData.get('email'),
    password: formData.get('password')
  });
  loginBtn.disabled = false;
  loginBtn.textContent = 'Entrar';
  if (error) {
    loginNote.textContent = 'Correo o contraseña incorrectos.';
    return;
  }
  loginForm.reset();
  showSession(data.session);
});

$('logoutBtn').addEventListener('click', async () => {
  await db.auth.signOut();
  showSession(null);
});

// ── Resumen ────────────────────────────────────────────────────────────
async function loadStats() {
  const firstOfMonth = todayIso().slice(0, 8) + '01';
  const [inProgress, achieved, monthSessions] = await Promise.all([
    db.from('goals').select('id', { count: 'exact', head: true }).eq('status', 'en_progreso'),
    db.from('goals').select('id', { count: 'exact', head: true }).eq('status', 'logrado'),
    db.from('therapy_sessions').select('id', { count: 'exact', head: true }).gte('session_date', firstOfMonth)
  ]);
  $('statPatients').textContent = patients.filter((p) => p.status === 'activo').length;
  $('statInProgress').textContent = inProgress.count ?? 0;
  $('statAchieved').textContent = achieved.count ?? 0;
  $('statSessions').textContent = monthSessions.count ?? 0;
}

// ── Lista de pacientes ─────────────────────────────────────────────────
async function loadPatients() {
  const { data, error } = await db.from('patients').select('*').order('full_name');
  if (error) {
    patientList.innerHTML = '<li class="pt-list-empty">No se pudieron cargar los pacientes. Recarga la página.</li>';
    console.error(error);
    return;
  }
  patients = data;
  renderPatientList();
}

function renderPatientList() {
  const query = normalize(patientSearch.value.trim());
  const visible = patients.filter((p) =>
    (statusFilter === 'todos' || p.status === statusFilter) &&
    (!query || normalize(p.full_name).includes(query))
  );

  if (!visible.length) {
    const message = patients.length
      ? 'No hay pacientes con este filtro.'
      : 'Aún no tienes pacientes. Agrega el primero con “+ Nuevo”.';
    patientList.innerHTML = `<li class="pt-list-empty">${message}</li>`;
    return;
  }

  patientList.innerHTML = visible.map((p) => {
    const meta = [ageLabel(p.birth_date), p.diagnosis].filter(Boolean).join(' · ');
    const selected = currentPatient && currentPatient.id === p.id ? ' is-selected' : '';
    return `<li>
      <button type="button" class="pt-patient-item${selected}" data-id="${p.id}">
        <span class="pt-avatar" style="--av:${avatarColor(p.id)}">${escapeHtml(initials(p.full_name))}</span>
        <span>
          <span class="pt-patient-name">${escapeHtml(p.full_name)}</span>
          <span class="pt-patient-meta">${escapeHtml(meta || PATIENT_STATUS_LABELS[p.status])}</span>
        </span>
      </button>
    </li>`;
  }).join('');
}

patientSearch.addEventListener('input', renderPatientList);

document.querySelectorAll('.pt-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    statusFilter = chip.dataset.filter;
    document.querySelectorAll('.pt-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    renderPatientList();
  });
});

patientList.addEventListener('click', (e) => {
  const item = e.target.closest('.pt-patient-item');
  if (item) selectPatient(item.dataset.id, true);
});

// ── Ficha del paciente ─────────────────────────────────────────────────
async function selectPatient(id, scrollIntoView = false) {
  currentPatient = patients.find((p) => p.id === id) || null;
  renderPatientList();
  if (!currentPatient) {
    detailEmpty.hidden = false;
    detailContent.hidden = true;
    return;
  }
  renderProfile();
  detailEmpty.hidden = true;
  detailContent.hidden = false;
  if (scrollIntoView && window.matchMedia('(max-width: 900px)').matches) {
    $('patientDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  await loadPatientData();
}

async function loadPatientData() {
  const patientId = currentPatient.id;
  const [goalsRes, sessionsRes] = await Promise.all([
    db.from('goals').select('*').eq('patient_id', patientId).order('created_at'),
    db.from('therapy_sessions').select('*').eq('patient_id', patientId)
      .order('session_date', { ascending: false }).order('created_at', { ascending: false })
  ]);
  if (!currentPatient || currentPatient.id !== patientId) return; // cambió de paciente mientras cargaba
  goals = goalsRes.data || [];
  sessions = sessionsRes.data || [];

  progressRows = [];
  if (goals.length) {
    const { data } = await db.from('goal_progress').select('*')
      .in('goal_id', goals.map((g) => g.id))
      .order('recorded_on').order('created_at');
    progressRows = data || [];
  }
  renderGoals();
  renderProgress();
  renderSessions();
}

function renderProfile() {
  const p = currentPatient;
  const avatar = $('profileAvatar');
  avatar.textContent = initials(p.full_name);
  avatar.style.setProperty('--av', avatarColor(p.id));
  $('profileName').textContent = p.full_name;
  const status = $('profileStatus');
  status.className = `pt-pill pt-pill-${p.status}`;
  status.textContent = PATIENT_STATUS_LABELS[p.status];

  const facts = [
    ['Edad', ageLabel(p.birth_date)],
    ['Diagnóstico', p.diagnosis],
    ['Apoderado/a', p.guardian_name],
    ['Teléfono', p.guardian_phone],
    ['Comuna', p.comuna],
    ['En terapia desde', formatDate(p.created_at)]
  ].filter(([, value]) => value);
  $('profileFacts').innerHTML = facts.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join('');

  const notes = $('profileNotes');
  notes.textContent = p.notes || '';
  notes.hidden = !p.notes;
}

// ── Pestañas ───────────────────────────────────────────────────────────
document.querySelectorAll('.pt-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.pt-tab').forEach((t) => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active);
      $(`tab-${t.dataset.tab}`).hidden = !active;
    });
  });
});

// ── Objetivos ──────────────────────────────────────────────────────────
function lastProgressDate(goalId) {
  const rows = progressRows.filter((r) => r.goal_id === goalId);
  return rows.length ? rows[rows.length - 1].recorded_on : null;
}

function renderGoals() {
  const achieved = goals.filter((g) => g.status === 'logrado').length;
  $('goalsSummary').textContent = goals.length
    ? `${goals.length} ${goals.length === 1 ? 'objetivo' : 'objetivos'} · ${achieved} ${achieved === 1 ? 'logrado' : 'logrados'}`
    : '';

  if (!goals.length) {
    goalList.innerHTML = `<div class="pt-panel-empty"><strong>Todavía no hay objetivos</strong>
      Agrega el primero con “+ Nuevo objetivo”, por ejemplo “Recortar siguiendo una línea recta”.</div>`;
    return;
  }

  const sorted = [...goals].sort((a, b) => GOAL_STATUS_ORDER[a.status] - GOAL_STATUS_ORDER[b.status]);
  goalList.innerHTML = sorted.map((g) => {
    const area = AREAS[g.area];
    const last = lastProgressDate(g.id);
    const meta = [
      g.target_date ? `Meta: ${formatDate(g.target_date)}` : '',
      last ? `Último registro: ${formatDate(last)}` : ''
    ].filter(Boolean).join(' · ');
    return `<article class="pt-goal${g.status === 'logrado' ? ' is-done' : ''}" style="--area:${area.color}">
      <div class="pt-goal-top">
        <span class="pt-area">${area.label}</span>
        <span class="pt-pill pt-pill-${g.status}">${GOAL_STATUS_LABELS[g.status]}</span>
      </div>
      <h3>${escapeHtml(g.title)}</h3>
      ${g.description ? `<p class="pt-goal-desc">${escapeHtml(g.description)}</p>` : ''}
      <div class="pt-goal-progress">
        <div class="pt-bar" role="progressbar" aria-valuenow="${g.progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Logro del objetivo"><span style="width:${g.progress}%"></span></div>
        <span class="pt-goal-pct">${g.progress}%</span>
      </div>
      ${meta ? `<div class="pt-goal-meta">${meta}</div>` : ''}
      <div class="pt-goal-actions">
        <button type="button" class="pt-btn pt-btn-primary pt-btn-small" data-action="progress" data-id="${g.id}">Registrar avance</button>
        <button type="button" class="pt-btn pt-btn-ghost pt-btn-small" data-action="edit" data-id="${g.id}">Editar</button>
      </div>
    </article>`;
  }).join('');
}

goalList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const goal = goals.find((g) => g.id === btn.dataset.id);
  if (btn.dataset.action === 'progress') openProgressDialog(goal);
  if (btn.dataset.action === 'edit') openGoalDialog(goal);
});

// ── Avance (gráficos) ──────────────────────────────────────────────────
function renderProgress() {
  const overall = $('overallProgress');
  const charts = $('progressCharts');
  if (!goals.length) {
    overall.hidden = true;
    charts.innerHTML = `<div class="pt-panel-empty"><strong>Sin avances para mostrar</strong>
      Cuando agregues objetivos y registres avances, aquí verás cómo evoluciona cada uno.</div>`;
    return;
  }

  const average = Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length);
  overall.hidden = false;
  overall.innerHTML = `
    <span class="pt-overall-value">${average}%</span>
    <span class="pt-overall-label">Logro promedio de ${goals.length} ${goals.length === 1 ? 'objetivo' : 'objetivos'}</span>
    <div class="pt-bar" role="progressbar" aria-valuenow="${average}" aria-valuemin="0" aria-valuemax="100" aria-label="Logro promedio"><span style="width:${average}%; background: var(--blue)"></span></div>`;

  charts.innerHTML = goals.map((g) => {
    const rows = progressRows.filter((r) => r.goal_id === g.id);
    const area = AREAS[g.area];
    const history = rows.length ? `<details>
        <summary>Ver historial (${rows.length})</summary>
        <table class="pt-history">
          <thead><tr><th>Fecha</th><th>Logro</th><th>Nota</th></tr></thead>
          <tbody>${[...rows].reverse().map((r) =>
            `<tr><td>${formatDate(r.recorded_on)}</td><td>${r.progress}%</td><td>${escapeHtml(r.note || '')}</td></tr>`
          ).join('')}</tbody>
        </table>
      </details>` : '';
    return `<div class="pt-chart-card" style="--area:${area.color}">
      <span class="pt-area">${area.label}</span>
      <h3>${escapeHtml(g.title)}</h3>
      ${progressChart(rows, area.color)}
      ${history}
    </div>`;
  }).join('');
}

// Línea de % de logro en el tiempo (eje 0–100 %, fechas en el eje x)
function progressChart(rows, color) {
  const W = 420, H = 160, L = 36, R = 44, T = 12, B = 26;
  const plotW = W - L - R, plotH = H - T - B;
  const y = (v) => T + plotH - (v / 100) * plotH;

  const grid = [0, 50, 100].map((v) =>
    `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line>
     <text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`
  ).join('');

  if (!rows.length) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sin registros de avance">${grid}
      <text class="axis-label" x="${L + plotW / 2}" y="${T + plotH / 2}" text-anchor="middle">Aún sin registros</text></svg>`;
  }

  const times = rows.map((r) => new Date(r.recorded_on + 'T12:00:00').getTime());
  const minT = Math.min(...times), maxT = Math.max(...times);
  const x = (t) => maxT === minT ? L + plotW / 2 : L + ((t - minT) / (maxT - minT)) * plotW;
  const points = rows.map((r, i) => ({ x: x(times[i]), y: y(r.progress), row: r }));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${y(0)} L${points[0].x.toFixed(1)},${y(0)} Z`;
  const last = points[points.length - 1];

  const xLabels = minT === maxT
    ? `<text class="axis-label" x="${x(minT)}" y="${H - 6}" text-anchor="middle">${formatDate(rows[0].recorded_on)}</text>`
    : `<text class="axis-label" x="${L}" y="${H - 6}" text-anchor="start">${formatDate(rows[0].recorded_on)}</text>
       <text class="axis-label" x="${W - R}" y="${H - 6}" text-anchor="end">${formatDate(rows[rows.length - 1].recorded_on)}</text>`;

  const dots = points.map((p) => `
    <circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" stroke="#ffffff" stroke-width="2"></circle>
    <circle class="hit" cx="${p.x}" cy="${p.y}" r="12"
      data-date="${p.row.recorded_on}" data-value="${p.row.progress}" data-note="${escapeHtml(p.row.note || '')}"></circle>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Avance: ${rows.map((r) => `${formatDate(r.recorded_on)} ${r.progress}%`).join(', ')}">
    ${grid}
    <path d="${area}" fill="${color}" fill-opacity="0.12"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
    ${dots}
    <text class="end-label" x="${last.x + 9}" y="${last.y + 4}">${last.row.progress}%</text>
    ${xLabels}
  </svg>`;
}

$('progressCharts').addEventListener('mouseover', (e) => {
  const hit = e.target.closest('.hit');
  if (!hit) return;
  const note = hit.dataset.note ? `<br>${hit.dataset.note}` : '';
  tooltip.innerHTML = `<strong>${hit.dataset.value}%</strong>${formatDate(hit.dataset.date)}${note}`;
  tooltip.hidden = false;
});
$('progressCharts').addEventListener('mousemove', (e) => {
  if (tooltip.hidden) return;
  const left = Math.min(e.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${e.clientY + 14}px`;
});
$('progressCharts').addEventListener('mouseout', (e) => {
  if (e.target.closest('.hit')) tooltip.hidden = true;
});

// ── Sesiones ───────────────────────────────────────────────────────────
function participationDots(value) {
  if (!value) return '';
  const dots = [1, 2, 3, 4, 5].map((n) => `<i class="${n <= value ? 'on' : ''}"></i>`).join('');
  return `<span class="pt-dots" title="Participación ${value} de 5">${dots}<span>Participación ${value}/5</span></span>`;
}

function renderSessions() {
  $('sessionsSummary').textContent = sessions.length
    ? `${sessions.length} ${sessions.length === 1 ? 'sesión registrada' : 'sesiones registradas'} · última el ${formatDate(sessions[0].session_date)}`
    : '';

  if (!sessions.length) {
    sessionList.innerHTML = `<li class="pt-panel-empty"><strong>Sin sesiones registradas</strong>
      Usa “+ Registrar sesión” después de cada atención para anotar qué trabajaron y cómo le fue.</li>`;
    return;
  }

  sessionList.innerHTML = sessions.map((s) => `<li class="pt-session">
      <div class="pt-session-head">
        <span class="pt-session-date">${formatDate(s.session_date)}</span>
        ${participationDots(s.participation)}
      </div>
      ${s.activities ? `<p><span class="pt-session-label">Actividades</span><br>${escapeHtml(s.activities)}</p>` : ''}
      ${s.observations ? `<p><span class="pt-session-label">Observaciones</span><br>${escapeHtml(s.observations)}</p>` : ''}
      <p><button type="button" class="pt-link-btn" data-id="${s.id}">Editar</button></p>
    </li>`).join('');
}

sessionList.addEventListener('click', (e) => {
  const btn = e.target.closest('.pt-link-btn');
  if (btn) openSessionDialog(sessions.find((s) => s.id === btn.dataset.id));
});

// ── Ventanas: comunes ──────────────────────────────────────────────────
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

function askConfirm(title, text) {
  const dialog = $('confirmDialog');
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

async function afterChange() {
  await loadPatientData();
  await loadStats();
}

// ── Ventana: paciente ──────────────────────────────────────────────────
const patientForm = $('patientForm');

function openPatientDialog(patient = null) {
  editingPatientId = patient ? patient.id : null;
  patientForm.reset();
  $('patientFormNote').textContent = '';
  $('patientDialogTitle').textContent = patient ? 'Editar ficha' : 'Nuevo paciente';
  $('deletePatientBtn').hidden = !patient;
  if (patient) {
    $('pFullName').value = patient.full_name;
    $('pBirthDate').value = patient.birth_date || '';
    $('pStatus').value = patient.status;
    $('pDiagnosis').value = patient.diagnosis || '';
    $('pGuardianName').value = patient.guardian_name || '';
    $('pGuardianPhone').value = patient.guardian_phone || '';
    $('pComuna').value = patient.comuna || '';
    $('pNotes').value = patient.notes || '';
  }
  $('patientDialog').showModal();
}

$('newPatientBtn').addEventListener('click', () => openPatientDialog());
$('editPatientBtn').addEventListener('click', () => openPatientDialog(currentPatient));

patientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(patientForm);
  const payload = {
    full_name: formData.get('full_name').trim(),
    birth_date: emptyToNull(formData.get('birth_date')),
    status: formData.get('status'),
    diagnosis: emptyToNull(formData.get('diagnosis')),
    guardian_name: emptyToNull(formData.get('guardian_name')),
    guardian_phone: emptyToNull(formData.get('guardian_phone')),
    comuna: emptyToNull(formData.get('comuna')),
    notes: emptyToNull(formData.get('notes'))
  };
  const query = editingPatientId
    ? db.from('patients').update(payload).eq('id', editingPatientId).select().single()
    : db.from('patients').insert(payload).select().single();
  const { data, error } = await query;
  if (error) return showError($('patientFormNote'), error);

  $('patientDialog').close();
  await loadPatients();
  // Que el paciente guardado quede visible aunque su estado no coincida con el filtro
  if (statusFilter !== 'todos' && statusFilter !== data.status) {
    document.querySelector(`.pt-chip[data-filter="${data.status}"]`).click();
  }
  await selectPatient(data.id);
  await loadStats();
});

$('deletePatientBtn').addEventListener('click', async () => {
  const patient = patients.find((p) => p.id === editingPatientId);
  $('patientDialog').close();
  const ok = await askConfirm(
    `¿Eliminar a ${patient.full_name}?`,
    'Se borrarán su ficha, objetivos, avances y sesiones. Esto no se puede deshacer. Si terminó la terapia, puedes cambiar su estado a “Alta” en vez de eliminarlo.'
  );
  if (!ok) return;
  const { error } = await db.from('patients').delete().eq('id', patient.id);
  if (error) { console.error(error); return; }
  currentPatient = null;
  await loadPatients();
  await selectPatient(null);
  await loadStats();
});

// ── Ventana: objetivo ──────────────────────────────────────────────────
const goalForm = $('goalForm');
$('gArea').innerHTML = Object.entries(AREAS).map(([value, area]) =>
  `<option value="${value}">${area.label}</option>`
).join('');

function openGoalDialog(goal = null) {
  editingGoalId = goal ? goal.id : null;
  goalForm.reset();
  $('goalFormNote').textContent = '';
  $('goalDialogTitle').textContent = goal ? 'Editar objetivo' : 'Nuevo objetivo';
  $('deleteGoalBtn').hidden = !goal;
  if (goal) {
    $('gTitle').value = goal.title;
    $('gArea').value = goal.area;
    $('gTargetDate').value = goal.target_date || '';
    $('gDescription').value = goal.description || '';
  }
  $('goalDialog').showModal();
}

$('newGoalBtn').addEventListener('click', () => openGoalDialog());

goalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(goalForm);
  const payload = {
    title: formData.get('title').trim(),
    area: formData.get('area'),
    target_date: emptyToNull(formData.get('target_date')),
    description: emptyToNull(formData.get('description'))
  };

  if (editingGoalId) {
    const { error } = await db.from('goals').update(payload).eq('id', editingGoalId);
    if (error) return showError($('goalFormNote'), error);
  } else {
    const { data, error } = await db.from('goals')
      .insert({ ...payload, patient_id: currentPatient.id }).select().single();
    if (error) return showError($('goalFormNote'), error);
    // Punto de partida en 0 % para que el gráfico muestre la evolución desde el inicio
    await db.from('goal_progress').insert({ goal_id: data.id, progress: 0, note: 'Inicio del objetivo', recorded_on: todayIso() });
  }
  $('goalDialog').close();
  await afterChange();
});

$('deleteGoalBtn').addEventListener('click', async () => {
  const goal = goals.find((g) => g.id === editingGoalId);
  $('goalDialog').close();
  const ok = await askConfirm('¿Eliminar este objetivo?', `“${goal.title}” y todo su historial de avance se borrarán.`);
  if (!ok) return;
  const { error } = await db.from('goals').delete().eq('id', goal.id);
  if (error) { console.error(error); return; }
  await afterChange();
});

// ── Ventana: avance ────────────────────────────────────────────────────
const progressForm = $('progressForm');
const progressInput = $('prValue');

function updateProgressLabel() {
  $('prValueLabel').textContent = `${progressInput.value}%`;
}

function openProgressDialog(goal) {
  progressGoalId = goal.id;
  progressForm.reset();
  $('progressFormNote').textContent = '';
  $('progressGoalTitle').textContent = goal.title;
  progressInput.value = goal.progress;
  $('prDate').value = todayIso();
  updateProgressLabel();
  $('progressDialog').showModal();
}

progressInput.addEventListener('input', updateProgressLabel);
document.querySelectorAll('.pt-quick button').forEach((btn) => {
  btn.addEventListener('click', () => {
    progressInput.value = btn.dataset.value;
    updateProgressLabel();
  });
});

progressForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(progressForm);
  const { error } = await db.from('goal_progress').insert({
    goal_id: progressGoalId,
    progress: Number(formData.get('progress')),
    recorded_on: formData.get('recorded_on'),
    note: emptyToNull(formData.get('note'))
  });
  if (error) return showError($('progressFormNote'), error);
  $('progressDialog').close();
  await afterChange();
});

// ── Ventana: sesión ────────────────────────────────────────────────────
const sessionForm = $('sessionForm');

function openSessionDialog(session = null) {
  editingSessionId = session ? session.id : null;
  sessionForm.reset();
  $('sessionFormNote').textContent = '';
  $('sessionDialogTitle').textContent = session ? 'Editar sesión' : 'Registrar sesión';
  $('deleteSessionBtn').hidden = !session;
  $('sDate').value = session ? session.session_date : todayIso();
  if (session) {
    $('sActivities').value = session.activities || '';
    $('sObservations').value = session.observations || '';
    if (session.participation) $(`sPart${session.participation}`).checked = true;
  }
  $('sessionDialog').showModal();
}

$('newSessionBtn').addEventListener('click', () => openSessionDialog());

sessionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(sessionForm);
  const payload = {
    session_date: formData.get('session_date'),
    participation: formData.get('participation') ? Number(formData.get('participation')) : null,
    activities: emptyToNull(formData.get('activities')),
    observations: emptyToNull(formData.get('observations'))
  };
  const { error } = editingSessionId
    ? await db.from('therapy_sessions').update(payload).eq('id', editingSessionId)
    : await db.from('therapy_sessions').insert({ ...payload, patient_id: currentPatient.id });
  if (error) return showError($('sessionFormNote'), error);
  $('sessionDialog').close();
  await afterChange();
});

$('deleteSessionBtn').addEventListener('click', async () => {
  const session = sessions.find((s) => s.id === editingSessionId);
  $('sessionDialog').close();
  const ok = await askConfirm('¿Eliminar esta sesión?', `Se borrará el registro del ${formatDate(session.session_date)}.`);
  if (!ok) return;
  const { error } = await db.from('therapy_sessions').delete().eq('id', session.id);
  if (error) { console.error(error); return; }
  await afterChange();
});

// ── Inicio ─────────────────────────────────────────────────────────────
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((_event, session) => {
  if (!session) showSession(null);
});
