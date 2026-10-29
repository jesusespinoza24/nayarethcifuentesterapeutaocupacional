const AREAS = {
  motricidad_fina: { label: 'Motricidad fina', color: '#4361ee' },
  avd: { label: 'Vida diaria (AVD)', color: '#e8590c' },
  motricidad_gruesa: { label: 'Motricidad gruesa', color: '#0f9d8a' },
  sensorial: { label: 'Procesamiento sensorial', color: '#c2255c' },
  cognicion_juego: { label: 'Cognición y juego', color: '#7048e8' },
  social_conducta: { label: 'Social y conducta', color: '#b08800' }
};
const PATIENT_STATUS_LABELS = { activo: 'Activo', pausa: 'En pausa', alta: 'Alta' };
const INSURANCE_LABELS = { fonasa: 'Fonasa', isapre: 'Isapre', particular: 'Particular' };
const SESSION_KIND_LABELS = { evaluacion: 'Evaluación', intervencion: 'Intervención' };
const GOAL_STATUS_LABELS = { pendiente: 'Pendiente', en_progreso: 'En progreso', logrado: 'Cumplido' };
// Niveles de apoyo: se guardan como % en goal_progress; "Independiente" (100) cumple el objetivo
const LEVELS = [
  { value: 0, label: 'No lo logra aún', short: 'No logra' },
  { value: 25, label: 'Con ayuda física', short: 'Ayuda física' },
  { value: 50, label: 'Con ayuda verbal o visual', short: 'Ayuda verbal' },
  { value: 75, label: 'Con supervisión', short: 'Supervisión' },
  { value: 100, label: 'Independiente', short: 'Independiente' }
];
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
let evaluations = [];
let unpaidByPatient = {};
let editingEvaluationId = null;
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

// RUT chileno: se guarda como 12.345.678-9 y se valida con el dígito verificador
function cleanRut(rut) {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

function formatRut(rut) {
  const clean = cleanRut(rut);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}

function isValidRut(rut) {
  const clean = cleanRut(rut);
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;
  let sum = 0, factor = 2;
  for (let i = clean.length - 2; i >= 0; i--) {
    sum += Number(clean[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const expected = 11 - (sum % 11);
  const dv = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);
  return dv === clean.slice(-1);
}

function levelIndex(progress) {
  let index = 0;
  LEVELS.forEach((level, i) => { if (progress >= level.value) index = i; });
  return index;
}

function levelFor(progress) {
  return LEVELS[levelIndex(progress)];
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
  const [inProgress, achieved, monthSessions, unpaid] = await Promise.all([
    db.from('goals').select('id', { count: 'exact', head: true }).eq('status', 'en_progreso'),
    db.from('goals').select('id', { count: 'exact', head: true }).eq('status', 'logrado'),
    db.from('therapy_sessions').select('id', { count: 'exact', head: true }).gte('session_date', firstOfMonth),
    db.from('therapy_sessions').select('patient_id').eq('paid', false)
  ]);
  unpaidByPatient = {};
  (unpaid.data || []).forEach((s) => { unpaidByPatient[s.patient_id] = (unpaidByPatient[s.patient_id] || 0) + 1; });
  $('statPatients').textContent = patients.filter((p) => p.status === 'activo').length;
  $('statInProgress').textContent = inProgress.count ?? 0;
  $('statAchieved').textContent = achieved.count ?? 0;
  $('statSessions').textContent = monthSessions.count ?? 0;
  $('statUnpaid').textContent = (unpaid.data || []).length;
  renderPatientList();
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
  const rutQuery = cleanRut(query);
  const visible = patients.filter((p) =>
    (statusFilter === 'todos' || p.status === statusFilter) &&
    (!query || normalize(p.full_name).includes(query) ||
      (rutQuery.length >= 3 && p.rut && cleanRut(p.rut).includes(rutQuery)))
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
    const unpaid = unpaidByPatient[p.id] || 0;
    const unpaidBadge = unpaid
      ? `<span class="pt-unpaid-badge">${unpaid} ${unpaid === 1 ? 'pago pendiente' : 'pagos pendientes'}</span>`
      : '';
    return `<li>
      <button type="button" class="pt-patient-item${selected}" data-id="${p.id}">
        <span class="pt-avatar" style="--av:${avatarColor(p.id)}">${escapeHtml(initials(p.full_name))}</span>
        <span>
          <span class="pt-patient-name">${escapeHtml(p.full_name)}</span>
          <span class="pt-patient-meta">${escapeHtml(meta || PATIENT_STATUS_LABELS[p.status])}</span>
          ${unpaidBadge}
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
  const changed = !currentPatient || currentPatient.id !== id;
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
  // Al abrir otro paciente se muestra la pestaña de la etapa en que va
  if (changed) showTab(currentStep().tab);
}

async function loadPatientData() {
  const patientId = currentPatient.id;
  const [goalsRes, sessionsRes, evaluationsRes] = await Promise.all([
    db.from('goals').select('*').eq('patient_id', patientId).order('created_at'),
    db.from('therapy_sessions').select('*').eq('patient_id', patientId)
      .order('session_date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('evaluations').select('*').eq('patient_id', patientId).order('eval_date').order('created_at')
  ]);
  if (!currentPatient || currentPatient.id !== patientId) return; // cambió de paciente mientras cargaba
  goals = goalsRes.data || [];
  sessions = sessionsRes.data || [];
  evaluations = evaluationsRes.data || [];

  progressRows = [];
  if (goals.length) {
    const { data } = await db.from('goal_progress').select('*')
      .in('goal_id', goals.map((g) => g.id))
      .order('recorded_on').order('created_at');
    progressRows = data || [];
  }
  renderSteps();
  renderEvaluations();
  renderGoals();
  renderProgress();
  renderSessions();
  renderReport();
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
    ['RUT', p.rut],
    ['Edad', ageLabel(p.birth_date)],
    ['Colegio', p.school],
    ['Curso', p.grade],
    ['Previsión', INSURANCE_LABELS[p.health_insurance]],
    ['Diagnóstico', p.diagnosis],
    ['Motivo de consulta', p.consultation_reason],
    ['Persona responsable', p.guardian_name],
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

  const generalGoal = $('generalGoalText');
  generalGoal.textContent = p.general_goal || 'Aún no hay objetivo general. Usa “Editar” para escribirlo.';
  generalGoal.classList.toggle('is-empty', !p.general_goal);
}

// ── Pestañas ───────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.pt-tab').forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', active);
    $(`tab-${t.dataset.tab}`).hidden = !active;
  });
}

document.querySelectorAll('.pt-tab').forEach((tab) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});

// ── Etapas de la terapia ───────────────────────────────────────────────
// 1) ficha clínica, 2) pauta de evaluación (sesiones 1–2),
// 3) objetivos específicos desde la sesión 3, 4) informe final
function processSteps() {
  const p = currentPatient;
  const hasReport = !!p.final_report_date;
  return [
    { title: 'Ficha clínica', detail: 'Datos del paciente', done: true, tab: 'goals', edit: true },
    { title: 'Evaluación', detail: 'Sesiones 1 y 2', done: evaluations.length > 0, tab: 'evaluation' },
    {
      title: 'Objetivos y avance',
      detail: goals.length ? `${goals.filter((g) => g.status === 'logrado').length}/${goals.length} cumplidos` : 'Desde la sesión 3',
      done: hasReport,
      tab: 'goals'
    },
    { title: 'Informe final', detail: hasReport ? formatDate(p.final_report_date) : 'Al terminar', done: hasReport, tab: 'report' }
  ];
}

function currentStep() {
  const steps = processSteps();
  return steps.find((s) => !s.done) || steps[steps.length - 1];
}

function renderSteps() {
  const steps = processSteps();
  const currentIndex = steps.findIndex((s) => !s.done);
  $('processSteps').innerHTML = steps.map((s, i) => {
    const state = s.done ? 'is-done' : i === currentIndex ? 'is-current' : '';
    return `<li class="pt-step ${state}">
      <button type="button" data-step="${i}">
        <span class="pt-step-num">${s.done ? '✓' : i + 1}</span>
        <span><strong>${s.title}</strong><small>${s.detail}</small></span>
      </button>
    </li>`;
  }).join('');
}

$('processSteps').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-step]');
  if (!btn) return;
  const step = processSteps()[Number(btn.dataset.step)];
  if (step.edit) openPatientDialog(currentPatient);
  else showTab(step.tab);
});

// ── Evaluación ─────────────────────────────────────────────────────────
function renderEvaluations() {
  const list = $('evaluationList');
  if (!evaluations.length) {
    list.innerHTML = `<div class="pt-panel-empty"><strong>Aún no hay evaluaciones</strong>
      Registra aquí la pauta que apliques en las sesiones 1 y 2, con sus resultados y conclusiones.</div>`;
    return;
  }
  list.innerHTML = evaluations.map((ev) => `<article class="pt-eval">
      <div class="pt-session-head">
        <span class="pt-session-date">${escapeHtml(ev.instrument)}</span>
        <span class="pt-goal-meta">${formatDate(ev.eval_date)}</span>
      </div>
      ${ev.results ? `<p><span class="pt-session-label">Resultados</span><br>${escapeHtml(ev.results)}</p>` : ''}
      ${ev.conclusions ? `<p><span class="pt-session-label">Conclusiones y áreas a intervenir</span><br>${escapeHtml(ev.conclusions)}</p>` : ''}
      <p><button type="button" class="pt-link-btn" data-id="${ev.id}">Editar</button></p>
    </article>`).join('');
}

$('evaluationList').addEventListener('click', (e) => {
  const btn = e.target.closest('.pt-link-btn');
  if (btn) openEvaluationDialog(evaluations.find((ev) => ev.id === btn.dataset.id));
});

// ── Objetivos ──────────────────────────────────────────────────────────
function goalRows(goalId) {
  return progressRows.filter((r) => r.goal_id === goalId);
}

function lastProgressDate(goalId) {
  const rows = goalRows(goalId);
  return rows.length ? rows[rows.length - 1].recorded_on : null;
}

// Fecha del último registro en "Independiente", o sea, cuándo se cumplió
function achievedDate(goalId) {
  const rows = goalRows(goalId).filter((r) => r.progress >= 100);
  return rows.length ? rows[rows.length - 1].recorded_on : null;
}

function levelSteps(progress) {
  const current = levelIndex(progress);
  const steps = LEVELS.map((_, i) => `<span class="${i <= current ? 'on' : ''}"></span>`).join('');
  return `<div class="pt-level">
    <div class="pt-level-steps" aria-hidden="true">${steps}</div>
    <span class="pt-level-label">${levelFor(progress).label}</span>
  </div>`;
}

function goalCard(g) {
  const area = AREAS[g.area];
  const done = g.status === 'logrado';
  const last = lastProgressDate(g.id);
  const achieved = done ? achievedDate(g.id) : null;
  const meta = done
    ? (achieved ? `Cumplido el ${formatDate(achieved)}` : '')
    : [
      g.target_date ? `Meta: ${formatDate(g.target_date)}` : '',
      last ? `Último registro: ${formatDate(last)}` : ''
    ].filter(Boolean).join(' · ');
  const actions = done
    ? `<button type="button" class="pt-btn pt-btn-ghost pt-btn-small" data-action="reopen" data-id="${g.id}">Reabrir</button>
       <button type="button" class="pt-btn pt-btn-ghost pt-btn-small" data-action="edit" data-id="${g.id}">Editar</button>`
    : `<button type="button" class="pt-btn pt-btn-primary pt-btn-small" data-action="progress" data-id="${g.id}">Registrar avance</button>
       <button type="button" class="pt-btn pt-btn-done pt-btn-small" data-action="complete" data-id="${g.id}">Marcar como cumplido</button>
       <button type="button" class="pt-btn pt-btn-ghost pt-btn-small" data-action="edit" data-id="${g.id}">Editar</button>`;
  return `<article class="pt-goal${done ? ' is-done' : ''}" style="--area:${area.color}">
      <div class="pt-goal-top">
        <span class="pt-area">${area.label}</span>
        <span class="pt-pill pt-pill-${g.status}">${GOAL_STATUS_LABELS[g.status]}</span>
      </div>
      <h3>${escapeHtml(g.title)}</h3>
      ${g.description ? `<p class="pt-goal-desc">${escapeHtml(g.description)}</p>` : ''}
      ${g.strategies ? `<p class="pt-goal-strategies"><span class="pt-section-label">Estrategias</span>${escapeHtml(g.strategies)}</p>` : ''}
      ${levelSteps(g.progress)}
      ${meta ? `<div class="pt-goal-meta">${meta}</div>` : ''}
      <div class="pt-goal-actions">${actions}</div>
    </article>`;
}

function renderGoals() {
  const open = goals.filter((g) => g.status !== 'logrado')
    .sort((a, b) => GOAL_STATUS_ORDER[a.status] - GOAL_STATUS_ORDER[b.status]);
  const done = goals.filter((g) => g.status === 'logrado')
    .sort((a, b) => (achievedDate(b.id) || '').localeCompare(achievedDate(a.id) || ''));

  $('goalsSummary').textContent = goals.length
    ? `${open.length} en curso · ${done.length} ${done.length === 1 ? 'cumplido' : 'cumplidos'}`
    : '';

  if (!goals.length) {
    goalList.innerHTML = `<div class="pt-panel-empty"><strong>Todavía no hay objetivos específicos</strong>
      Agrega el primero con “+ Objetivo específico”, por ejemplo “Recortar siguiendo una línea recta”.</div>`;
  } else if (!open.length) {
    goalList.innerHTML = `<div class="pt-panel-empty"><strong>¡Todos los objetivos específicos están cumplidos!</strong>
      Agrega uno nuevo cuando definan el siguiente paso.</div>`;
  } else {
    goalList.innerHTML = open.map(goalCard).join('');
  }

  $('doneGoals').hidden = !done.length;
  $('doneCount').textContent = done.length;
  $('doneGoalList').innerHTML = done.map(goalCard).join('');
}

$('tab-goals').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const goal = goals.find((g) => g.id === btn.dataset.id);
  const action = btn.dataset.action;
  if (action === 'progress') openProgressDialog(goal);
  if (action === 'edit') openGoalDialog(goal);
  if (action === 'complete' || action === 'reopen') {
    btn.disabled = true;
    // Al reabrir se vuelve al último nivel registrado antes de cumplirlo
    const before = goalRows(goal.id).filter((r) => r.progress < 100);
    const row = action === 'complete'
      ? { progress: 100, note: 'Marcado como cumplido' }
      : { progress: before.length ? before[before.length - 1].progress : 0, note: 'Objetivo reabierto' };
    const { error } = await db.from('goal_progress').insert({ goal_id: goal.id, recorded_on: todayIso(), ...row });
    if (error) { console.error(error); btn.disabled = false; return; }
    await afterChange();
  }
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

  const done = goals.filter((g) => g.status === 'logrado').length;
  const share = Math.round((done / goals.length) * 100);
  overall.hidden = false;
  overall.innerHTML = `
    <span class="pt-overall-value">${done}/${goals.length}</span>
    <span class="pt-overall-label">objetivos específicos cumplidos</span>
    <div class="pt-bar" role="progressbar" aria-valuenow="${share}" aria-valuemin="0" aria-valuemax="100" aria-label="Objetivos cumplidos"><span style="width:${share}%; background: var(--teal)"></span></div>`;

  charts.innerHTML = goals.map((g) => {
    const rows = goalRows(g.id);
    const area = AREAS[g.area];
    const achieved = g.status === 'logrado' ? achievedDate(g.id) : null;
    const history = rows.length ? `<details>
        <summary>Ver historial (${rows.length})</summary>
        <table class="pt-history">
          <thead><tr><th>Fecha</th><th>Nivel</th><th>Nota</th></tr></thead>
          <tbody>${[...rows].reverse().map((r) =>
            `<tr><td>${formatDate(r.recorded_on)}</td><td>${levelFor(r.progress).label}</td><td>${escapeHtml(r.note || '')}</td></tr>`
          ).join('')}</tbody>
        </table>
      </details>` : '';
    return `<div class="pt-chart-card" style="--area:${area.color}">
      <div class="pt-goal-top">
        <span class="pt-area">${area.label}</span>
        ${achieved ? `<span class="pt-pill pt-pill-logrado">Cumplido el ${formatDate(achieved)}</span>` : ''}
      </div>
      <h3>${escapeHtml(g.title)}</h3>
      ${progressChart(rows, area.color)}
      ${history}
    </div>`;
  }).join('');
}

// Nivel de apoyo en el tiempo (de "No logra" a "Independiente", fechas en el eje x)
function progressChart(rows, color) {
  const W = 420, H = 170, L = 98, R = 16, T = 10, B = 26;
  const plotW = W - L - R, plotH = H - T - B;
  const y = (index) => T + plotH - (index / (LEVELS.length - 1)) * plotH;

  const grid = LEVELS.map((level, i) =>
    `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(i)}" y2="${y(i)}"></line>
     <text class="axis-label" x="${L - 8}" y="${y(i) + 4}" text-anchor="end">${level.short}</text>`
  ).join('');

  if (!rows.length) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sin registros de avance">${grid}
      <text class="axis-label" x="${L + plotW / 2}" y="${T + plotH / 2}" text-anchor="middle">Aún sin registros</text></svg>`;
  }

  const times = rows.map((r) => new Date(r.recorded_on + 'T12:00:00').getTime());
  const minT = Math.min(...times), maxT = Math.max(...times);
  const x = (t) => maxT === minT ? L + plotW / 2 : L + ((t - minT) / (maxT - minT)) * plotW;
  const points = rows.map((r, i) => ({ x: x(times[i]), y: y(levelIndex(r.progress)), row: r }));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${y(0)} L${points[0].x.toFixed(1)},${y(0)} Z`;

  const xLabels = minT === maxT
    ? `<text class="axis-label" x="${x(minT)}" y="${H - 6}" text-anchor="middle">${formatDate(rows[0].recorded_on)}</text>`
    : `<text class="axis-label" x="${L}" y="${H - 6}" text-anchor="start">${formatDate(rows[0].recorded_on)}</text>
       <text class="axis-label" x="${W - R}" y="${H - 6}" text-anchor="end">${formatDate(rows[rows.length - 1].recorded_on)}</text>`;

  const dots = points.map((p, i) => {
    const isLast = i === points.length - 1;
    return `
    <circle cx="${p.x}" cy="${p.y}" r="${isLast ? 6 : 4}" fill="${color}" stroke="#ffffff" stroke-width="2"></circle>
    <circle class="hit" cx="${p.x}" cy="${p.y}" r="12"
      data-date="${p.row.recorded_on}" data-level="${levelFor(p.row.progress).label}" data-note="${escapeHtml(p.row.note || '')}"></circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Avance: ${rows.map((r) => `${formatDate(r.recorded_on)} ${levelFor(r.progress).label}`).join(', ')}">
    ${grid}
    <path d="${area}" fill="${color}" fill-opacity="0.12"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
    ${dots}
    ${xLabels}
  </svg>`;
}

$('progressCharts').addEventListener('mouseover', (e) => {
  const hit = e.target.closest('.hit');
  if (!hit) return;
  const note = hit.dataset.note ? `<br>${hit.dataset.note}` : '';
  tooltip.innerHTML = `<strong>${hit.dataset.level}</strong>${formatDate(hit.dataset.date)}${note}`;
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
  const unpaid = sessions.filter((s) => !s.paid).length;
  $('sessionsSummary').textContent = sessions.length
    ? `${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'} · ` +
      (unpaid ? `${unpaid} con pago pendiente` : 'todas pagadas')
    : '';

  if (!sessions.length) {
    sessionList.innerHTML = `<li class="pt-panel-empty"><strong>Sin sesiones registradas</strong>
      Usa “+ Registrar sesión” después de cada atención para anotar qué trabajaron y cómo le fue.</li>`;
    return;
  }

  // La lista va de la más reciente a la más antigua; el número cuenta desde la primera
  sessionList.innerHTML = sessions.map((s, i) => `<li class="pt-session pt-session-${s.kind}">
      <div class="pt-session-head">
        <span class="pt-session-date">Sesión ${sessions.length - i} · ${formatDate(s.session_date)}</span>
        <span class="pt-session-tags">
          <span class="pt-pill pt-pill-${s.kind}">${SESSION_KIND_LABELS[s.kind] || 'Intervención'}</span>
          <button type="button" class="pt-pay ${s.paid ? 'is-paid' : ''}" data-pay="${s.id}"
            title="${s.paid ? 'Marcar como pendiente' : 'Marcar como pagada'}">${s.paid ? 'Pagada' : 'Pago pendiente'}</button>
        </span>
      </div>
      ${participationDots(s.participation)}
      ${s.activities ? `<p><span class="pt-session-label">Actividades</span><br>${escapeHtml(s.activities)}</p>` : ''}
      ${s.observations ? `<p><span class="pt-session-label">Observaciones</span><br>${escapeHtml(s.observations)}</p>` : ''}
      <p><button type="button" class="pt-link-btn" data-id="${s.id}">Editar</button></p>
    </li>`).join('');
}

sessionList.addEventListener('click', async (e) => {
  const pay = e.target.closest('[data-pay]');
  if (pay) {
    const session = sessions.find((s) => s.id === pay.dataset.pay);
    pay.disabled = true;
    const { error } = await db.from('therapy_sessions').update({ paid: !session.paid }).eq('id', session.id);
    if (error) { console.error(error); pay.disabled = false; return; }
    await afterChange();
    return;
  }
  const btn = e.target.closest('.pt-link-btn');
  if (btn) openSessionDialog(sessions.find((s) => s.id === btn.dataset.id));
});

// ── Informe final ──────────────────────────────────────────────────────
const reportForm = $('reportForm');

function renderReport() {
  const p = currentPatient;
  $('rDate').value = p.final_report_date || todayIso();
  $('rConclusions').value = p.final_conclusions || '';
  $('rRecommendations').value = p.final_recommendations || '';
  $('rDischarge').checked = false;
  $('reportFormNote').textContent = '';
  $('reportSaved').textContent = p.final_report_date ? `Guardado · ${formatDate(p.final_report_date)}` : '';
  renderReportDoc();
}

// Arma el informe con los datos de la ficha, la evaluación, los objetivos y las sesiones
function renderReportDoc() {
  const p = currentPatient;
  const ordered = [...sessions].reverse();
  const evalCount = sessions.filter((s) => s.kind === 'evaluacion').length;
  const period = ordered.length
    ? `${formatDate(ordered[0].session_date)} al ${formatDate(ordered[ordered.length - 1].session_date)}`
    : 'Sin sesiones registradas';
  const facts = [
    ['Nombre', p.full_name],
    ['RUT', p.rut],
    ['Fecha de nacimiento', p.birth_date ? `${formatDate(p.birth_date)} (${ageLabel(p.birth_date)})` : ''],
    ['Colegio', [p.school, p.grade].filter(Boolean).join(' · ')],
    ['Previsión', INSURANCE_LABELS[p.health_insurance]],
    ['Persona responsable', p.guardian_name],
    ['Diagnóstico', p.diagnosis]
  ].filter(([, v]) => v);
  const paragraph = (text) => text ? `<p>${escapeHtml(text)}</p>` : '<p class="pt-report-empty">Sin completar.</p>';
  const conclusions = $('rConclusions').value.trim();
  const recommendations = $('rRecommendations').value.trim();
  const reportDate = $('rDate').value;

  const goalRowsHtml = goals.map((g) => {
    const rows = goalRows(g.id);
    const first = rows.length ? levelFor(rows[0].progress).label : '—';
    const achieved = g.status === 'logrado' ? achievedDate(g.id) : null;
    return `<tr>
      <td>${escapeHtml(g.title)}<br><small>${AREAS[g.area].label}</small></td>
      <td>${first}</td>
      <td>${levelFor(g.progress).label}</td>
      <td>${achieved ? `Cumplido el ${formatDate(achieved)}` : GOAL_STATUS_LABELS[g.status]}</td>
    </tr>`;
  }).join('');

  $('reportDoc').innerHTML = `
    <header class="pt-report-head">
      <div>
        <h2>Informe final de Terapia Ocupacional</h2>
        <p>${reportDate ? formatDate(reportDate) : ''}</p>
      </div>
      <div class="pt-report-brand">
        <strong>Nayareth Cifuentes Fuchslocher</strong>
        <span>Terapeuta Ocupacional · Registro SIS N° 935279</span>
      </div>
    </header>

    <section>
      <h3>Antecedentes</h3>
      <dl class="pt-report-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
      <h4>Motivo de consulta</h4>
      ${paragraph(p.consultation_reason)}
    </section>

    <section>
      <h3>Proceso terapéutico</h3>
      <p>Periodo: ${period}. Total: ${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}
        (${evalCount} de evaluación y ${sessions.length - evalCount} de intervención).</p>
    </section>

    <section>
      <h3>Evaluación</h3>
      ${evaluations.length ? evaluations.map((ev) => `
        <h4>${escapeHtml(ev.instrument)} · ${formatDate(ev.eval_date)}</h4>
        ${ev.results ? `<p>${escapeHtml(ev.results)}</p>` : ''}
        ${ev.conclusions ? `<p>${escapeHtml(ev.conclusions)}</p>` : ''}`).join('') : '<p class="pt-report-empty">Sin evaluaciones registradas.</p>'}
    </section>

    <section>
      <h3>Objetivos</h3>
      <h4>Objetivo general</h4>
      ${paragraph(p.general_goal)}
      <h4>Objetivos específicos</h4>
      ${goals.length ? `<div class="pt-report-table"><table>
        <thead><tr><th>Objetivo</th><th>Nivel inicial</th><th>Nivel final</th><th>Estado</th></tr></thead>
        <tbody>${goalRowsHtml}</tbody>
      </table></div>` : '<p class="pt-report-empty">Sin objetivos específicos.</p>'}
    </section>

    <section>
      <h3>Conclusiones</h3>
      ${paragraph(conclusions)}
      <h3>Recomendaciones</h3>
      ${paragraph(recommendations)}
    </section>

    <footer class="pt-report-sign">
      <span></span>
      Nayareth Cifuentes Fuchslocher<br>Terapeuta Ocupacional
    </footer>`;
}

// La vista previa se actualiza mientras se escribe
['rDate', 'rConclusions', 'rRecommendations'].forEach((id) => $(id).addEventListener('input', renderReportDoc));

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('reportFormNote').textContent = '';
  const formData = new FormData(reportForm);
  const payload = {
    final_report_date: formData.get('final_report_date'),
    final_conclusions: emptyToNull(formData.get('final_conclusions')),
    final_recommendations: emptyToNull(formData.get('final_recommendations'))
  };
  if (formData.get('discharge')) payload.status = 'alta';
  const { data, error } = await db.from('patients').update(payload).eq('id', currentPatient.id).select().single();
  if (error) return showError($('reportFormNote'), error);
  Object.assign(currentPatient, data);
  renderProfile();
  renderSteps();
  renderReport();
  renderPatientList();
  await loadStats();
});

$('printReportBtn').addEventListener('click', () => {
  renderReportDoc();
  $('printReport').innerHTML = $('reportDoc').innerHTML;
  window.print();
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
    $('pRut').value = patient.rut || '';
    $('pSchool').value = patient.school || '';
    $('pGrade').value = patient.grade || '';
    $('pBirthDate').value = patient.birth_date || '';
    $('pStatus').value = patient.status;
    $('pDiagnosis').value = patient.diagnosis || '';
    $('pReason').value = patient.consultation_reason || '';
    $('pGeneralGoal').value = patient.general_goal || '';
    $('pGuardianName').value = patient.guardian_name || '';
    $('pGuardianPhone').value = patient.guardian_phone || '';
    $('pComuna').value = patient.comuna || '';
    $('pInsurance').value = patient.health_insurance || '';
    $('pNotes').value = patient.notes || '';
  }
  updateAgeHint();
  $('patientDialog').showModal();
}

function updateAgeHint() {
  const age = ageLabel($('pBirthDate').value);
  $('pAge').textContent = age ? `Edad: ${age}` : '';
}

$('pBirthDate').addEventListener('input', updateAgeHint);
$('pRut').addEventListener('blur', () => {
  if ($('pRut').value.trim()) $('pRut').value = formatRut($('pRut').value);
});

$('newPatientBtn').addEventListener('click', () => openPatientDialog());
$('editPatientBtn').addEventListener('click', () => openPatientDialog(currentPatient));
$('editGeneralGoalBtn').addEventListener('click', () => {
  openPatientDialog(currentPatient);
  $('pGeneralGoal').focus();
});

patientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(patientForm);
  const rut = emptyToNull(formData.get('rut'));
  if (rut && !isValidRut(rut)) {
    $('patientFormNote').textContent = 'El RUT no es válido. Revisa los números y el dígito verificador.';
    $('pRut').focus();
    return;
  }
  const payload = {
    full_name: formData.get('full_name').trim(),
    rut: rut ? formatRut(rut) : null,
    school: emptyToNull(formData.get('school')),
    grade: emptyToNull(formData.get('grade')),
    birth_date: emptyToNull(formData.get('birth_date')),
    status: formData.get('status'),
    diagnosis: emptyToNull(formData.get('diagnosis')),
    consultation_reason: emptyToNull(formData.get('consultation_reason')),
    general_goal: emptyToNull(formData.get('general_goal')),
    guardian_name: emptyToNull(formData.get('guardian_name')),
    guardian_phone: emptyToNull(formData.get('guardian_phone')),
    comuna: emptyToNull(formData.get('comuna')),
    health_insurance: emptyToNull(formData.get('health_insurance')),
    notes: emptyToNull(formData.get('notes'))
  };
  const query = editingPatientId
    ? db.from('patients').update(payload).eq('id', editingPatientId).select().single()
    : db.from('patients').insert(payload).select().single();
  const { data, error } = await query;
  if (error && error.code === '23505') {
    $('patientFormNote').textContent = 'Ya existe un paciente con ese RUT.';
    return;
  }
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
  $('goalDialogTitle').textContent = goal ? 'Editar objetivo específico' : 'Nuevo objetivo específico';
  $('deleteGoalBtn').hidden = !goal;
  if (goal) {
    $('gTitle').value = goal.title;
    $('gArea').value = goal.area;
    $('gTargetDate').value = goal.target_date || '';
    $('gDescription').value = goal.description || '';
    $('gStrategies').value = goal.strategies || '';
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
    description: emptyToNull(formData.get('description')),
    strategies: emptyToNull(formData.get('strategies'))
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
  const ok = await askConfirm('¿Eliminar este objetivo específico?', `“${goal.title}” y todo su historial de avance se borrarán.`);
  if (!ok) return;
  const { error } = await db.from('goals').delete().eq('id', goal.id);
  if (error) { console.error(error); return; }
  await afterChange();
});

// ── Ventana: avance ────────────────────────────────────────────────────
const progressForm = $('progressForm');
$('prLevels').innerHTML = LEVELS.map((level, i) => `
  <input type="radio" id="prLevel${i}" name="progress" value="${level.value}" required>
  <label for="prLevel${i}"><span class="pt-level-steps" aria-hidden="true">${
    LEVELS.map((_, j) => `<span class="${j <= i ? 'on' : ''}"></span>`).join('')
  }</span>${level.label}</label>`).join('');

function openProgressDialog(goal) {
  progressGoalId = goal.id;
  progressForm.reset();
  $('progressFormNote').textContent = '';
  $('progressGoalTitle').textContent = goal.title;
  $(`prLevel${levelIndex(goal.progress)}`).checked = true;
  $('prDate').value = todayIso();
  $('progressDialog').style.setProperty('--area', AREAS[goal.area].color);
  $('progressDialog').showModal();
}

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
  // Las sesiones 1 y 2 son de evaluación; desde la 3 comienza la intervención
  $('sKind').value = session ? session.kind : (sessions.length < 2 ? 'evaluacion' : 'intervencion');
  $('sPaid').checked = session ? session.paid : false;
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
    kind: formData.get('kind'),
    paid: formData.get('paid') === 'on',
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

// ── Ventana: evaluación ────────────────────────────────────────────────
const evaluationForm = $('evaluationForm');

function openEvaluationDialog(evaluation = null) {
  editingEvaluationId = evaluation ? evaluation.id : null;
  evaluationForm.reset();
  $('evaluationFormNote').textContent = '';
  $('evaluationDialogTitle').textContent = evaluation ? 'Editar evaluación' : 'Registrar evaluación';
  $('deleteEvaluationBtn').hidden = !evaluation;
  $('eDate').value = evaluation ? evaluation.eval_date : todayIso();
  if (evaluation) {
    $('eInstrument').value = evaluation.instrument;
    $('eResults').value = evaluation.results || '';
    $('eConclusions').value = evaluation.conclusions || '';
  }
  $('evaluationDialog').showModal();
}

$('newEvaluationBtn').addEventListener('click', () => openEvaluationDialog());

evaluationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(evaluationForm);
  const payload = {
    instrument: formData.get('instrument').trim(),
    eval_date: formData.get('eval_date'),
    results: emptyToNull(formData.get('results')),
    conclusions: emptyToNull(formData.get('conclusions'))
  };
  const { error } = editingEvaluationId
    ? await db.from('evaluations').update(payload).eq('id', editingEvaluationId)
    : await db.from('evaluations').insert({ ...payload, patient_id: currentPatient.id });
  if (error) return showError($('evaluationFormNote'), error);
  $('evaluationDialog').close();
  await afterChange();
});

$('deleteEvaluationBtn').addEventListener('click', async () => {
  const evaluation = evaluations.find((ev) => ev.id === editingEvaluationId);
  $('evaluationDialog').close();
  const ok = await askConfirm('¿Eliminar esta evaluación?', `Se borrará “${evaluation.instrument}” del ${formatDate(evaluation.eval_date)}.`);
  if (!ok) return;
  const { error } = await db.from('evaluations').delete().eq('id', evaluation.id);
  if (error) { console.error(error); return; }
  await afterChange();
});

// ── Inicio ─────────────────────────────────────────────────────────────
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((_event, session) => {
  if (!session) showSession(null);
});
