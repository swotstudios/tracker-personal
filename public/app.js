'use strict';

/* ---------- Utility ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 1) => n == null ? '–' : (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('it-IT');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const z = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const fmtDate = (s, o = { day: 'numeric', month: 'short' }) => parseISO(s).toLocaleDateString('it-IT', o);
const norm = s => String(s || '').trim().toLowerCase();
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clamp01 = x => Math.max(0, Math.min(1, x));

const DOW = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MEALS = ['Colazione', 'Pranzo', 'Spuntino', 'Cena'];
const UNITS = ['kg', 'kg/manubrio', 'kg assistenza'];
const isAssist = unit => /assist/i.test(unit || '');

/* ---------- Dati ---------- */
const LS_KEY = 'tracker-data-v1';
const mkEx = (name, unit, sets) => ({ id: uid(), name, unit, sets });
const defaultProgram = () => [
  { id: uid(), weekday: 2, name: 'LOWER A', exercises: [mkEx('Pressa a seduta scorrevole', 'kg', 3), mkEx('Leg extension', 'kg', 3), mkEx('Affondi con manubri', 'kg/manubrio', 2), mkEx('Calf raise', 'kg', 3)] },
  { id: uid(), weekday: 4, name: 'UPPER A', exercises: [mkEx('Panca piana', 'kg', 3), mkEx('Panca inclinata manubri', 'kg/manubrio', 3), mkEx('Lat machine', 'kg', 3), mkEx('Upper back machine', 'kg', 3), mkEx('Alzate laterali', 'kg/manubrio', 3), mkEx('Pushdown tricipiti', 'kg', 2)] },
  { id: uid(), weekday: 5, name: 'LOWER B', exercises: [mkEx('Stacco rumeno', 'kg', 3), mkEx('Leg curl seduto', 'kg', 3), mkEx('Pressa a seduta scorrevole', 'kg', 3), mkEx('Hip thrust', 'kg', 2), mkEx('Calf raise', 'kg', 3)] },
  { id: uid(), weekday: 6, name: 'UPPER B', exercises: [mkEx('Trazioni', 'kg assistenza', 3), mkEx('Pulley basso', 'kg', 3), mkEx('Shoulder press', 'kg', 3), mkEx('Pectoral machine', 'kg', 3), mkEx('Curl bicipiti', 'kg/manubrio', 3), mkEx('Alzate laterali', 'kg/manubrio', 2)] },
];
const defaultDB = () => ({
  version: 1, program: defaultProgram(), sessions: [], weights: [], foods: [], foodLib: {}, goals: [], notes: {},
  settings: { kcal: 2200, protein: 150, carbs: 250, fat: 70 },
});

let DB;
let mode = 'server';

const PW_KEY = 'tracker-password';
const getPw = () => { try { return localStorage.getItem(PW_KEY) || ''; } catch { return ''; } };
const apiHeaders = (extra = {}) => ({ 'x-tracker-key': getPw(), ...extra });

// Online (Vercel) i dati sono protetti da password: la chiediamo una volta e la ricordiamo su questo dispositivo
function askPassword(msg) {
  return new Promise(resolve => {
    $('#view').innerHTML = `
      <div class="card" style="max-width:380px;margin:12vh auto 0">
        <h2>Il mio tracker</h2>
        <p class="muted small">${msg || 'Inserisci la password per accedere ai tuoi dati.'}</p>
        <form class="row" id="loginForm">
          <input type="password" name="pw" placeholder="Password" autocomplete="current-password" style="flex:1" required autofocus>
          <button class="btn primary">Entra</button>
        </form>
      </div>`;
    $('#loginForm').addEventListener('submit', e => {
      e.preventDefault();
      try { localStorage.setItem(PW_KEY, e.target.pw.value); } catch { /* storage non disponibile */ }
      resolve();
    });
  });
}

async function load() {
  let data = null;
  for (;;) {
    let r;
    try { r = await fetch('/api/data', { cache: 'no-store', headers: apiHeaders() }); } catch { mode = 'local'; break; }
    if (r.status === 401) { await askPassword(getPw() ? 'Password errata, riprova.' : ''); continue; }
    if (r.status === 404 || r.status === 405) { mode = 'local'; break; }
    if (!r.ok) {
      $('#view').innerHTML = `<div class="card" style="max-width:520px;margin:12vh auto 0"><h2>Errore del server</h2><p class="muted">${esc(await r.text())}</p></div>`;
      return false;
    }
    data = await r.json();
    break;
  }
  if (!data) { try { data = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { data = null; } }
  DB = Object.assign(defaultDB(), data || {});
  DB.settings = Object.assign(defaultDB().settings, DB.settings);
  if (!data) save();
  return true;
}

let saveTimer = null;
function save() {
  setStatus('Salvataggio…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
async function flush(keepalive = false) {
  saveTimer = null;
  const body = JSON.stringify(DB);
  try { localStorage.setItem(LS_KEY, body); } catch { /* storage non disponibile */ }
  if (mode !== 'server') return setStatus('Salvato nel browser');
  try {
    const r = await fetch('/api/data', { method: 'PUT', headers: apiHeaders({ 'Content-Type': 'application/json' }), body, keepalive });
    if (r.status === 401) return setStatus('Password non valida: ricarica la pagina', true);
    if (!r.ok) throw new Error();
    setStatus('Salvato ✓');
  } catch { setStatus('Errore di salvataggio', true); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) { clearTimeout(saveTimer); flush(true); } });

function setStatus(t, err = false) { const el = $('#saveStatus'); el.textContent = t; el.classList.toggle('err', err); }
let toastTimer;
function toast(t, ms = 1800) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms); }

/* ---------- Calcoli ---------- */
const sessionsSorted = () => [...DB.sessions].sort((a, b) => a.date.localeCompare(b.date));
const weightsSorted = () => [...DB.weights].sort((a, b) => a.date.localeCompare(b.date));
const currentWeight = () => { const w = weightsSorted(); return w.length ? w[w.length - 1].kg : null; };

function exStats(e) {
  const sets = e.sets.filter(s => s.kg != null || s.reps != null);
  if (!sets.length) return null;
  const assist = isAssist(e.unit);
  const kgs = sets.map(s => s.kg ?? 0);
  const top = assist ? Math.min(...kgs) : Math.max(...kgs);
  const topSet = sets.filter(s => (s.kg ?? 0) === top).sort((a, b) => (b.reps || 0) - (a.reps || 0))[0];
  return {
    top, topReps: topSet.reps,
    e1rm: assist ? null : Math.max(...sets.map(s => (s.kg ?? 0) * (1 + (s.reps || 0) / 30))),
    volume: sets.reduce((a, s) => a + (s.kg ?? 0) * (s.reps || 0), 0),
    reps: sets.reduce((a, s) => a + (s.reps || 0), 0),
  };
}

function history(name) {
  const k = norm(name), out = [];
  for (const s of sessionsSorted()) for (const e of s.exercises) {
    if (norm(e.name) !== k) continue;
    const st = exStats(e);
    if (st) out.push({ date: s.date, ex: e, ...st });
  }
  return out;
}

function exUnit(name) {
  const k = norm(name);
  for (const d of DB.program) for (const e of d.exercises) if (norm(e.name) === k) return e.unit;
  for (const s of DB.sessions) for (const e of s.exercises) if (norm(e.name) === k) return e.unit;
  return 'kg';
}

function allExercises() {
  const seen = new Map();
  for (const d of DB.program) for (const e of d.exercises) if (!seen.has(norm(e.name))) seen.set(norm(e.name), e.name);
  for (const s of DB.sessions) for (const e of s.exercises) if (!seen.has(norm(e.name))) seen.set(norm(e.name), e.name);
  return [...seen.values()];
}

function bestOf(name, metric = 'top') {
  const h = history(name);
  if (!h.length) return null;
  if (metric === 'e1rm') return Math.max(...h.map(x => x.e1rm ?? 0));
  if (metric === 'volume') return Math.max(...h.map(x => x.volume));
  return isAssist(exUnit(name)) ? Math.min(...h.map(x => x.top)) : Math.max(...h.map(x => x.top));
}

function recentPRs(limit = 6) {
  const out = [];
  for (const name of allExercises()) {
    const h = history(name), assist = isAssist(exUnit(name));
    let best = null;
    h.forEach((x, i) => {
      const better = best == null || (assist ? x.top < best : x.top > best);
      if (better && i > 0) out.push({ date: x.date, name, top: x.top, reps: x.topReps, prev: best, unit: x.ex.unit });
      if (better) best = x.top;
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

const foodsOn = date => DB.foods.filter(f => f.date === date);
function totals(items) {
  return items.reduce((t, f) => ({ kcal: t.kcal + (f.kcal || 0), p: t.p + (f.p || 0), c: t.c + (f.c || 0), f: t.f + (f.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
}
const defaultMeal = () => { const h = new Date().getHours(); return h < 11 ? 'Colazione' : h < 15 ? 'Pranzo' : h < 18 ? 'Spuntino' : 'Cena'; };

function weekStart(date) { const d = parseISO(date); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return iso(d); }

/* Obiettivi */
function goalCurrent(g) {
  if (g.type === 'weight') return currentWeight();
  if (g.type === 'exercise') return bestOf(g.exercise, g.metric || 'top');
  return g.current ?? null;
}
function goalUnit(g) { return g.type === 'weight' ? 'kg' : g.type === 'exercise' ? (g.metric === 'e1rm' ? 'kg (1RM)' : exUnit(g.exercise)) : (g.unit || ''); }
function goalProgress(g) {
  if (g.type === 'custom' && g.target == null) return g.done ? 1 : 0;
  const cur = goalCurrent(g);
  if (cur == null || g.target == null) return 0;
  if (g.start == null) { g.start = cur; save(); }
  if (g.start === g.target) return cur === g.target ? 1 : 0;
  return clamp01((cur - g.start) / (g.target - g.start));
}
function goalTitle(g) {
  if (g.title) return g.title;
  if (g.type === 'weight') return `Peso corporeo: ${fmt(g.target)} kg`;
  if (g.type === 'exercise') return `${g.exercise}: ${fmt(g.target)} ${goalUnit(g)}`;
  return 'Obiettivo';
}

/* ---------- Grafici ---------- */
const charts = [];
let pendingCharts = [];
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const chartSpec = (id, pts, opts) => { pendingCharts.push({ id, pts, opts }); return `<canvas id="${id}"></canvas>`; };

function drawCharts() {
  charts.splice(0).forEach(c => c.destroy());
  if (!window.Chart) return;
  const color = cssVar('--series-1'), grid = cssVar('--grid'), txt = cssVar('--text-3'), surface = cssVar('--surface'), ref = cssVar('--text-2');
  for (const { id, pts, opts = {} } of pendingCharts.splice(0)) {
    const canvas = document.getElementById(id);
    if (!canvas || !pts.length) continue;
    const spark = !!opts.spark;
    const data = pts.map(p => ({ x: parseISO(p.date).getTime(), y: p.y, note: p.note }));
    const xs = data.map(d => d.x);
    let xmin = Math.min(...xs), xmax = Math.max(...xs);
    const pad = Math.max((xmax - xmin) * 0.04, 864e5);
    xmin -= pad; xmax += pad;
    const datasets = [{
      data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.25,
      pointRadius: spark ? 2.5 : 4, pointHoverRadius: 6, pointBorderColor: surface, pointBorderWidth: 2,
    }];
    if (opts.target != null) {
      datasets.push({ data: [{ x: xmin, y: opts.target }, { x: xmax, y: opts.target }], borderColor: ref, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0 });
    }
    charts.push(new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: spark ? 4 : { top: 6, right: 6 } },
        scales: {
          x: { type: 'linear', min: xmin, max: xmax, display: !spark, grid: { display: false }, border: { color: grid },
            ticks: { color: txt, maxTicksLimit: 6, maxRotation: 0, callback: v => new Date(v).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) } },
          y: { display: !spark, grace: '8%', grid: { color: grid }, border: { display: false }, ticks: { color: txt, maxTicksLimit: 5, callback: v => fmt(v) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: i => i.datasetIndex === 0, displayColors: false,
            callbacks: {
              title: items => new Date(items[0].parsed.x).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
              label: i => `${fmt(i.parsed.y)} ${opts.unit || ''}${i.raw.note ? ' · ' + i.raw.note : ''}`,
            },
          },
        },
      },
    }));
  }
}

function exSeries(name, metric) {
  const h = history(name);
  return h.map(x => ({
    date: x.date,
    y: metric === 'e1rm' ? x.e1rm : metric === 'volume' ? x.volume : x.top,
    note: metric === 'top' ? `${x.topReps ?? '–'} rep` : metric === 'volume' ? `${x.reps} rep totali` : `top ${fmt(x.top)} × ${x.topReps ?? '–'}`,
  })).filter(p => p.y != null);
}

/* ---------- Stato UI ---------- */
const ui = {
  view: 'dashboard',
  wDate: today(), wTplId: null, draft: null, dirty: false, editProgram: false,
  fDate: today(), calMonth: today().slice(0, 7), calSel: today(),
  metric: 'top', wRange: 90, dietEdit: false,
};

function tplForDate(date) {
  const s = DB.sessions.find(x => x.date === date);
  if (s && DB.program.some(p => p.id === s.templateId)) return s.templateId;
  const dow = parseISO(date).getDay();
  return (DB.program.find(p => p.weekday === dow) || DB.program[0] || {}).id || null;
}
function nextWorkout() {
  for (let i = 0; i < 7; i++) {
    const d = addDays(today(), i), dow = parseISO(d).getDay();
    const t = DB.program.find(p => p.weekday === dow);
    if (t && !DB.sessions.some(s => s.date === d && s.templateId === t.id)) return { date: d, tpl: t };
  }
  return null;
}

/* ---------- Vista: Dashboard ---------- */
function viewDashboard() {
  const t = today(), w = weightsSorted(), cur = currentWeight();
  const past = w.filter(x => x.date <= addDays(t, -30)).pop() || w[0];
  const delta = cur != null && past && past !== w[w.length - 1] ? cur - past.kg : null;
  const ws = weekStart(t);
  const weekSessions = DB.sessions.filter(s => s.date >= ws && s.date <= addDays(ws, 6));
  const tot = totals(foodsOn(t)), S = DB.settings;
  const range = ui.wRange ? w.filter(x => x.date >= addDays(t, -ui.wRange)) : w;
  const wGoal = DB.goals.find(g => g.type === 'weight' && !g.archived);
  const next = nextWorkout();
  const prs = recentPRs();
  const activeGoals = DB.goals.filter(g => !g.archived).slice(0, 4);

  return `
  <div class="page-head"><div><h2>Ciao 👋</h2><div class="muted small">${cap(fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div></div>
  <div class="grid g4">
    <div class="card kpi"><div class="label">Peso attuale</div><div class="value">${fmt(cur)} <small>kg</small></div>
      <div class="sub">${delta == null ? 'Registra il peso qui sotto' : `${delta > 0 ? '+' : ''}${fmt(delta)} kg dal ${fmtDate(past.date)}`}</div></div>
    <div class="card kpi"><div class="label">Allenamenti settimana</div><div class="value">${weekSessions.length} <small>/ ${DB.program.length}</small></div>
      <div class="sub">${weekSessions.map(s => esc(s.name)).join(' · ') || 'Nessuno ancora'}</div></div>
    <div class="card kpi"><div class="label">Calorie oggi</div><div class="value">${fmt(tot.kcal, 0)} <small>/ ${fmt(S.kcal, 0)}</small></div>
      <div class="bar ${tot.kcal > S.kcal ? 'over' : ''}" style="margin-top:8px"><i style="width:${clamp01(tot.kcal / S.kcal) * 100}%"></i></div></div>
    <div class="card kpi"><div class="label">Proteine oggi</div><div class="value">${fmt(tot.p, 0)} <small>/ ${fmt(S.protein, 0)} g</small></div>
      <div class="bar ${tot.p >= S.protein ? 'good' : ''}" style="margin-top:8px"><i style="width:${clamp01(tot.p / S.protein) * 100}%"></i></div></div>
  </div>

  <div class="grid g21" style="margin-top:14px">
    <div class="card">
      <div class="card-head"><h3>Andamento peso</h3>
        <div class="seg">${[[30, '30g'], [90, '90g'], [365, '1 anno'], [0, 'Tutto']].map(([v, l]) => `<button data-act="wRange" data-v="${v}" class="${ui.wRange === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      ${range.length ? `<div class="chart">${chartSpec('wChart', range.map(x => ({ date: x.date, y: x.kg })), { unit: 'kg', target: wGoal?.target })}</div>
        ${wGoal ? `<div class="faint small" style="margin-top:6px">- - - obiettivo ${fmt(wGoal.target)} kg</div>` : ''}`
        : `<div class="empty">Nessun peso registrato. Inizia qui sotto.</div>`}
      <form class="row" data-form="weight" style="margin-top:12px">
        <input type="date" name="date" value="${t}" max="${t}">
        <input name="kg" inputmode="decimal" placeholder="Peso (kg)" style="width:120px" required>
        <button class="btn primary">Registra peso</button>
      </form>
    </div>
    <div class="stack">
      <div class="card">
        <h3>Prossimo allenamento</h3>
        ${next ? `<div style="margin:8px 0 12px"><div style="font-size:20px;font-weight:650">${esc(next.tpl.name)}</div>
          <div class="muted small">${next.date === t ? 'Oggi' : cap(fmtDate(next.date, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${next.tpl.exercises.length} esercizi</div></div>
          <button class="btn primary" data-act="goWorkout" data-date="${next.date}" data-tpl="${next.tpl.id}">${next.date === t ? 'Inizia ora' : 'Apri scheda'}</button>`
          : `<div class="empty">Tutto fatto per questa settimana 💪</div>`}
      </div>
      <div class="card">
        <div class="card-head" style="margin-bottom:6px"><h3>Obiettivi</h3><a href="#obiettivi" class="small" style="color:var(--accent)">Tutti</a></div>
        ${activeGoals.length ? activeGoals.map(g => { const p = goalProgress(g); return `
          <div class="meter" style="margin-top:10px"><div class="top"><span>${esc(goalTitle(g))}</span><b>${Math.round(p * 100)}%</b></div>
          <div class="bar ${p >= 1 ? 'good' : ''}"><i style="width:${p * 100}%"></i></div></div>`; }).join('')
          : `<div class="empty">Nessun obiettivo. <a href="#obiettivi" style="color:var(--accent)">Aggiungine uno</a></div>`}
      </div>
    </div>
  </div>

  <div class="grid g2" style="margin-top:14px">
    <div class="card">
      <h3>Record recenti 🏆</h3>
      ${prs.length ? prs.map(p => `<div class="list-row"><span class="chip good">PR</span><div class="spacer"><b>${esc(p.name)}</b><div class="faint small">${fmtDate(p.date)} · prima ${fmt(p.prev)} kg</div></div>
        <b class="tnum">${fmt(p.top)} ${esc(p.unit)} × ${p.reps ?? '–'}</b></div>`).join('')
        : `<div class="empty">I nuovi record sui carichi compariranno qui.</div>`}
    </div>
    <div class="card">
      <h3>Impostazioni</h3>
      <div class="grid g4" style="margin-top:10px;gap:8px">
        ${[['kcal', 'Kcal/giorno'], ['protein', 'Proteine g'], ['carbs', 'Carbo g'], ['fat', 'Grassi g']].map(([k, l]) =>
          `<label class="field">${l}<input data-bind="setting" data-k="${k}" inputmode="decimal" value="${S[k] ?? ''}"></label>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-act="export">Esporta backup</button>
        <label class="btn">Importa backup<input type="file" accept=".json,application/json" data-bind="import" hidden></label>
        <span class="faint small">${mode === 'server' ? 'Dati salvati sul server' : 'Dati salvati solo in questo browser'}</span>
        ${getPw() ? `<button class="btn ghost sm" data-act="logout">Esci</button>` : ''}
      </div>
    </div>
  </div>`;
}

/* ---------- Vista: Allenamento ---------- */
function getDraft() {
  const d = ui.draft;
  if (d && d.date === ui.wDate && d.templateId === ui.wTplId) return d;
  const existing = DB.sessions.find(s => s.date === ui.wDate && s.templateId === ui.wTplId);
  const tpl = DB.program.find(p => p.id === ui.wTplId);
  ui.dirty = false;
  if (existing) ui.draft = { ...JSON.parse(JSON.stringify(existing)), existingId: existing.id };
  else ui.draft = {
    date: ui.wDate, templateId: ui.wTplId, name: tpl?.name || 'Allenamento', notes: '',
    exercises: (tpl?.exercises || []).map(e => ({ name: e.name, unit: e.unit, target: e.sets, sets: Array.from({ length: e.sets }, () => ({ kg: null, reps: null })) })),
  };
  return ui.draft;
}
const lastBefore = (name, date) => history(name).filter(x => x.date < date).pop();
const setsText = e => e.sets.filter(s => s.kg != null || s.reps != null).map(s => `${fmt(s.kg ?? 0)}×${s.reps ?? '–'}`).join(' · ');

function viewWorkout() {
  if (ui.editProgram) return viewProgramEditor();
  if (!ui.wTplId || !DB.program.some(p => p.id === ui.wTplId)) ui.wTplId = tplForDate(ui.wDate);
  const d = getDraft();
  const recent = sessionsSorted().reverse().slice(0, 12);

  return `
  <div class="page-head"><h2>Allenamento</h2>
    <div class="row"><button class="btn ghost" data-act="editProgram">✏️ Modifica scheda</button></div></div>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <button class="btn icon" data-act="wDay" data-n="-1" aria-label="Giorno precedente">‹</button>
        <input type="date" data-bind="wDate" value="${ui.wDate}">
        <button class="btn icon" data-act="wDay" data-n="1" aria-label="Giorno successivo">›</button>
        ${ui.wDate !== today() ? `<button class="btn sm ghost" data-act="wToday">Oggi</button>` : ''}
      </div>
      ${d.existingId ? `<span class="chip good">✓ Registrato</span>` : `<span class="chip">Non ancora registrato</span>`}
    </div>
    <div class="tpl-pills" style="margin-top:12px">
      ${DB.program.map(p => `<button data-act="wTpl" data-id="${p.id}" class="${p.id === ui.wTplId ? 'on' : ''}"><small>${DOW[p.weekday] ?? ''}</small>${esc(p.name)}</button>`).join('')}
    </div>
  </div>

  ${d.exercises.map((e, ei) => {
    const last = lastBefore(e.name, ui.wDate), lastEx = last?.ex;
    const best = bestOf(e.name);
    const series = exSeries(e.name, 'top');
    return `
    <div class="card ex-card">
      <div class="ex-top">
        <div><h3>${esc(e.name)}</h3><div class="faint small">${esc(e.unit)}${e.target ? ` · ${e.target} serie` : ''}${isAssist(e.unit) ? ' · meno assistenza = meglio' : ''}</div></div>
        ${best != null ? `<span class="chip accent">Record ${fmt(best)} kg</span>` : ''}
      </div>
      <div class="ex-body">
        <div>
          <div class="sets">
            <span class="h"></span><span class="h">${isAssist(e.unit) ? 'kg assist.' : 'kg'}</span><span class="h">Rep</span>
            ${e.sets.map((s, si) => { const ls = lastEx?.sets[si]; return `
              <span class="n">${si + 1}</span>
              <input data-bind="set" data-ei="${ei}" data-si="${si}" data-f="kg" inputmode="decimal" value="${s.kg ?? ''}" placeholder="${ls?.kg ?? '–'}">
              <input data-bind="set" data-ei="${ei}" data-si="${si}" data-f="reps" inputmode="numeric" value="${s.reps ?? ''}" placeholder="${ls?.reps ?? '–'}">`; }).join('')}
          </div>
          <div class="ex-actions">
            <button class="btn sm ghost" data-act="addSet" data-ei="${ei}">+ serie</button>
            ${e.sets.length > 1 ? `<button class="btn sm ghost" data-act="rmSet" data-ei="${ei}">− serie</button>` : ''}
            ${lastEx ? `<button class="btn sm ghost" data-act="fillLast" data-ei="${ei}">↺ Copia ultima volta</button>` : ''}
            <button class="btn sm ghost danger" data-act="rmEx" data-ei="${ei}">Rimuovi</button>
          </div>
        </div>
        <div class="ex-side">
          ${series.length ? `<div class="chart xs">${chartSpec('sp' + ei, series, { spark: true, unit: e.unit })}</div>` : ''}
          <div class="small" style="margin-top:6px">${last ? `<span class="faint">Ultima volta (${fmtDate(last.date)}):</span><br><b class="tnum">${setsText(lastEx)}</b>` : `<span class="faint">Prima volta: nessuno storico.</span>`}</div>
        </div>
      </div>
    </div>`;
  }).join('')}

  <div class="card">
    <form class="row" data-form="addEx">
      <input name="name" list="exlist" placeholder="Aggiungi esercizio extra…" style="flex:1" required autocomplete="off">
      <button class="btn">+ Aggiungi</button>
    </form>
    <textarea data-bind="wNotes" placeholder="Note (sensazioni, dolori, tecnica…)" style="margin-top:10px">${esc(d.notes || '')}</textarea>
    <div class="row" style="margin-top:12px">
      <button class="btn primary" data-act="saveWorkout">💾 Salva allenamento</button>
      ${d.existingId ? `<button class="btn danger" data-act="delWorkout">Elimina</button>` : ''}
    </div>
  </div>

  <div class="card">
    <h3>Storico</h3>
    ${recent.length ? recent.map(s => `<div class="list-row"><div class="spacer"><b>${esc(s.name)}</b> <span class="faint small">· ${cap(fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
      <div class="faint small">${s.exercises.length} esercizi · ${s.exercises.reduce((a, e) => a + e.sets.length, 0)} serie</div></div>
      <button class="btn sm" data-act="goWorkout" data-date="${s.date}" data-tpl="${s.templateId}">Apri</button></div>`).join('')
      : `<div class="empty">Ancora nessun allenamento salvato.</div>`}
  </div>`;
}

function viewProgramEditor() {
  return `
  <div class="page-head"><h2>Modifica scheda</h2><button class="btn primary" data-act="editProgram">Fatto</button></div>
  ${DB.program.map((p, di) => `
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <select data-bind="pDay" data-di="${di}">${DOW.map((n, i) => `<option value="${i}" ${p.weekday === i ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <input data-bind="pName" data-di="${di}" value="${esc(p.name)}" style="flex:1;font-weight:600">
        <button class="btn sm danger" data-act="rmDay" data-di="${di}">Elimina giorno</button>
      </div>
      <div class="prog-table">
        <span class="faint small">Esercizio</span><span class="faint small">Unità</span><span class="faint small">Serie</span><span></span>
        ${p.exercises.map((e, xi) => `
          <input data-bind="pEx" data-di="${di}" data-xi="${xi}" data-f="name" value="${esc(e.name)}" list="exlist">
          <select data-bind="pEx" data-di="${di}" data-xi="${xi}" data-f="unit">${UNITS.map(u => `<option ${e.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
          <input data-bind="pEx" data-di="${di}" data-xi="${xi}" data-f="sets" type="number" min="1" max="10" value="${e.sets}">
          <span class="row" style="gap:2px;flex-wrap:nowrap">
            <button class="btn sm ghost" data-act="mvPex" data-di="${di}" data-xi="${xi}" ${xi === 0 ? 'disabled' : ''} aria-label="Sposta su">↑</button>
            <button class="btn sm ghost danger" data-act="rmPex" data-di="${di}" data-xi="${xi}" aria-label="Rimuovi">×</button>
          </span>`).join('')}
      </div>
      <button class="btn sm" data-act="addPex" data-di="${di}" style="margin-top:10px">+ Esercizio</button>
    </div>`).join('')}
  <div class="row" style="margin-top:14px">
    <button class="btn" data-act="addDay">+ Aggiungi giorno</button>
    <button class="btn ghost" data-act="resetProgram">Ripristina scheda iniziale</button>
  </div>
  <p class="faint small">Lo storico è legato al nome dell'esercizio: se lo rinomini, i grafici ripartono dal nuovo nome.</p>`;
}

/* ---------- Pannello cibo (usato in Cibo e Calendario) ---------- */
function foodPanel(date) {
  const items = foodsOn(date), tot = totals(items), S = DB.settings;
  const lib = Object.values(DB.foodLib).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 14);
  const meter = (label, v, t, unit, goodWhenReached) => `
    <div class="meter"><div class="top"><span>${label}</span><b>${fmt(v, 0)} <span class="faint">/ ${fmt(t, 0)} ${unit}</span></b></div>
    <div class="bar ${goodWhenReached ? (v >= t ? 'good' : '') : (v > t ? 'over' : '')}"><i style="width:${t ? clamp01(v / t) * 100 : 0}%"></i></div></div>`;
  return `
  <div class="card">
    <div class="grid g4" style="gap:16px">
      ${meter('Calorie', tot.kcal, S.kcal, 'kcal', false)}
      ${meter('Proteine', tot.p, S.protein, 'g', true)}
      ${meter('Carboidrati', tot.c, S.carbs, 'g', false)}
      ${meter('Grassi', tot.f, S.fat, 'g', false)}
    </div>
  </div>
  <div class="card">
    <form class="food-form" data-form="food" data-date="${date}" autocomplete="off">
      <label class="field f-name">Alimento<input name="name" list="foodlist" placeholder="Cosa hai mangiato? (es. Petto di pollo)" required></label>
      <label class="field">Grammi<input name="qty" inputmode="decimal" placeholder="g"></label>
      <label class="field">Kcal<input name="kcal" inputmode="decimal" placeholder="kcal"></label>
      <label class="field">Prot.<input name="p" inputmode="decimal" placeholder="g"></label>
      <label class="field">Carbo<input name="c" inputmode="decimal" placeholder="g"></label>
      <label class="field">Grassi<input name="f" inputmode="decimal" placeholder="g"></label>
      <label class="field f-meal">Pasto<select name="meal">${MEALS.map(m => `<option ${m === defaultMeal() ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <button class="btn primary f-btn">Aggiungi</button>
    </form>
    ${lib.length ? `<div class="quick"><span class="faint small" style="align-self:center">Veloci:</span>
      ${lib.map(f => `<button data-act="quickFood" data-key="${esc(norm(f.name))}" data-date="${date}">${esc(f.name)}<small>${f.qty ? fmt(f.qty, 0) + 'g · ' : ''}${fmt(f.kcal || 0, 0)}</small></button>`).join('')}</div>`
      : `<div class="faint small" style="margin-top:10px">Scrivi nome e valori una volta: la prossima volta basterà un tap (o scegliere il nome dai suggerimenti, i valori si compilano da soli).</div>`}
  </div>
  <div class="card">
    <div class="card-head"><h3>Pasti</h3>
      <button class="btn sm ghost" data-act="copyFoods" data-date="${date}">↺ Copia da giorno prima</button></div>
    ${items.length ? MEALS.filter(m => items.some(f => f.meal === m)).map(m => {
      const list = items.filter(f => f.meal === m), mt = totals(list);
      return `<div class="meal"><div class="meal-head"><span>${m}</span><span class="tnum">${fmt(mt.kcal, 0)} kcal</span></div>
        ${list.map(f => { const dc = dietCheck(f.name); return `<div class="food-item"><div>${esc(f.name)}${f.qty ? ` <span class="faint small">${fmt(f.qty, 0)} g</span>` : ''}${dc?.status === 'avoid' ? ' <span class="chip bad">da evitare</span>' : dc?.status === 'limit' ? ` <span class="chip warn" title="${esc(dc.note)}">con limite</span>` : ''}
          <div class="macro">P ${fmt(f.p || 0, 0)} · C ${fmt(f.c || 0, 0)} · G ${fmt(f.f || 0, 0)}</div></div>
          <b class="tnum small">${fmt(f.kcal || 0, 0)} kcal</b>
          <button class="btn sm ghost" data-act="rmFood" data-id="${f.id}" aria-label="Rimuovi">×</button></div>`; }).join('')}</div>`;
    }).join('') : `<div class="empty">Niente registrato per questo giorno.</div>`}
  </div>`;
}

function viewFood() {
  const d = ui.fDate;
  return `
  <div class="page-head"><h2>Cibo</h2>
    <div class="row">
      <button class="btn icon" data-act="fDay" data-n="-1" aria-label="Giorno precedente">‹</button>
      <input type="date" data-bind="fDate" value="${d}">
      <button class="btn icon" data-act="fDay" data-n="1" aria-label="Giorno successivo">›</button>
      ${d !== today() ? `<button class="btn sm ghost" data-act="fToday">Oggi</button>` : ''}
    </div></div>
  ${foodPanel(d)}
  ${DB.diet ? freqCard(d) : ''}`;
}

/* ---------- Vista: Calendario ---------- */
function viewCalendar() {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = addDays(iso(first), -((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.slice(0, 7) !== ui.calMonth) break;
    cells.push(d);
  }
  const t = today(), sel = ui.calSel;
  const sessions = DB.sessions.filter(s => s.date === sel);
  const w = DB.weights.find(x => x.date === sel);
  const monthLabel = cap(first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }));

  return `
  <div class="page-head"><h2>Calendario</h2>
    <div class="row">
      <button class="btn icon" data-act="calMonth" data-n="-1" aria-label="Mese precedente">‹</button>
      <b style="min-width:140px;text-align:center">${monthLabel}</b>
      <button class="btn icon" data-act="calMonth" data-n="1" aria-label="Mese successivo">›</button>
      <button class="btn sm ghost" data-act="calToday">Oggi</button>
    </div></div>
  <div class="card">
    <div class="cal">
      ${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(x => `<div class="dow">${x}</div>`).join('')}
      ${cells.map(d => {
        const ss = DB.sessions.filter(s => s.date === d), kc = totals(foodsOn(d)).kcal, wk = DB.weights.find(x => x.date === d);
        return `<button class="cal-cell ${d.slice(0, 7) !== ui.calMonth ? 'out' : ''} ${d === t ? 'today' : ''} ${d === sel ? 'sel' : ''}" data-act="calSel" data-date="${d}">
          <span class="d">${parseISO(d).getDate()}</span>
          ${ss.map(s => `<span class="w">${esc(s.name)}</span>`).join('')}
          ${kc ? `<span class="k">🍽 ${fmt(kc, 0)}</span>` : ''}
          ${wk ? `<span class="k">⚖️ ${fmt(wk.kg)}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
  </div>

  <div class="page-head" style="margin-top:24px"><h2>${cap(fmtDate(sel, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2></div>
  <div class="grid g2">
    <div class="card">
      <div class="card-head"><h3>Allenamento</h3>
        <button class="btn sm" data-act="goWorkout" data-date="${sel}" data-tpl="${sessions[0]?.templateId || ''}">${sessions.length ? 'Modifica' : '+ Registra'}</button></div>
      ${sessions.length ? sessions.map(s => `<div style="margin-bottom:8px"><b>${esc(s.name)}</b>
        ${s.exercises.map(e => `<div class="list-row small"><span class="spacer">${esc(e.name)}</span><span class="tnum muted">${setsText(e)}</span></div>`).join('')}
        ${s.notes ? `<div class="faint small" style="margin-top:6px">📝 ${esc(s.notes)}</div>` : ''}</div>`).join('')
        : `<div class="empty">Giorno di riposo (o non registrato).</div>`}
    </div>
    <div class="card">
      <h3>Peso & note</h3>
      <form class="row" data-form="weight" style="margin:10px 0">
        <input type="hidden" name="date" value="${sel}">
        <input name="kg" inputmode="decimal" placeholder="Peso (kg)" value="${w ? w.kg : ''}" style="width:130px" required>
        <button class="btn">${w ? 'Aggiorna' : 'Salva'} peso</button>
        ${w ? `<button type="button" class="btn ghost danger sm" data-act="rmWeight" data-date="${sel}">Elimina</button>` : ''}
      </form>
      <textarea data-bind="dayNote" data-date="${sel}" placeholder="Note del giorno (sonno, energia, umore…)">${esc(DB.notes[sel] || '')}</textarea>
    </div>
  </div>
  <h3 style="margin:22px 0 10px">Cibo</h3>
  ${foodPanel(sel)}`;
}

/* ---------- Vista: Progressi ---------- */
function viewProgress() {
  const metric = ui.metric;
  const names = allExercises();
  const withData = names.filter(n => history(n).length);
  const without = names.filter(n => !history(n).length);
  const w = weightsSorted();
  const labels = { top: 'Carico massimo', e1rm: '1RM stimato', volume: 'Volume (kg×rep)' };

  return `
  <div class="page-head"><h2>Progressi</h2>
    <div class="seg">${Object.entries(labels).map(([k, l]) => `<button data-act="metric" data-v="${k}" class="${metric === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  <div class="card">
    <div class="card-head"><h3>Peso corporeo</h3><span class="muted small tnum">${w.length ? `${fmt(w[0].kg)} → ${fmt(w[w.length - 1].kg)} kg` : ''}</span></div>
    ${w.length ? `<div class="chart sm">${chartSpec('pw', w.map(x => ({ date: x.date, y: x.kg })), { unit: 'kg' })}</div>` : `<div class="empty">Nessun peso registrato.</div>`}
  </div>
  <div class="grid gauto" style="margin-top:14px">
    ${withData.map((n, i) => {
      const unit = exUnit(n), assist = isAssist(unit);
      const series = exSeries(n, assist && metric === 'e1rm' ? 'top' : metric);
      const first = series[0]?.y, lastV = series[series.length - 1]?.y, diff = lastV - first;
      const better = assist && metric !== 'volume' ? diff < 0 : diff > 0;
      return `<div class="card">
        <div class="card-head" style="margin-bottom:4px"><div><h3>${esc(n)}</h3><div class="faint small">${esc(unit)} · ${series.length} sessioni</div></div>
          ${series.length > 1 && diff ? `<span class="chip ${better ? 'good' : 'warn'}">${diff > 0 ? '+' : ''}${fmt(diff)}</span>` : ''}</div>
        <div class="kpi"><div class="value" style="font-size:22px">${fmt(lastV)} <small>${metric === 'volume' ? 'kg×rep' : 'kg'}</small></div></div>
        <div class="chart sm">${chartSpec('px' + i, series, { unit: metric === 'volume' ? 'kg×rep' : 'kg' })}</div>
      </div>`;
    }).join('')}
  </div>
  ${!withData.length ? `<div class="card"><div class="empty">Registra il primo allenamento e qui vedrai un grafico per ogni esercizio.</div></div>` : ''}
  ${without.length && withData.length ? `<p class="faint small" style="margin-top:14px">Ancora senza dati: ${without.map(esc).join(', ')}</p>` : ''}`;
}

/* ---------- Vista: Obiettivi ---------- */
function goalCard(g) {
  const p = goalProgress(g), cur = goalCurrent(g), unit = goalUnit(g);
  if (p >= 1 && !g.achievedAt) { g.achievedAt = today(); save(); }
  if (p < 1 && g.achievedAt && g.type !== 'custom') { delete g.achievedAt; save(); }
  const left = g.deadline ? daysBetween(today(), g.deadline) : null;
  const series = g.type === 'weight' ? weightsSorted().map(x => ({ date: x.date, y: x.kg }))
    : g.type === 'exercise' ? exSeries(g.exercise, g.metric || 'top') : [];
  const numeric = g.type !== 'custom' || g.target != null;
  return `
  <div class="card goal">
    <div class="card-head" style="margin-bottom:4px">
      <div><h3>${esc(goalTitle(g))}</h3>
        <div class="faint small">${g.type === 'weight' ? 'Peso corporeo' : g.type === 'exercise' ? 'Carico esercizio' : 'Personale'}${g.createdAt ? ` · dal ${fmtDate(g.createdAt)}` : ''}</div></div>
      <div class="row">
        ${g.achievedAt ? `<span class="chip good">🎉 Raggiunto ${fmtDate(g.achievedAt)}</span>`
          : left != null ? `<span class="chip ${left < 0 ? 'warn' : ''}">${left < 0 ? `Scaduto da ${-left} g` : left === 0 ? 'Scade oggi' : `${left} giorni`}</span>` : ''}
      </div>
    </div>
    ${numeric ? `<div class="vals"><span>Partenza <b>${fmt(g.start)}</b></span><span>Attuale <b>${fmt(cur)}</b></span><span>Obiettivo <b>${fmt(g.target)} ${esc(unit)}</b></span></div>` : ''}
    <div class="meter"><div class="top"><span class="faint">Progresso</span><b>${Math.round(p * 100)}%</b></div><div class="bar ${p >= 1 ? 'good' : ''}"><i style="width:${p * 100}%"></i></div></div>
    ${series.length ? `<div class="chart sm" style="margin-top:12px">${chartSpec('g' + g.id, series, { unit: 'kg', target: g.target })}</div>` : ''}
    ${g.notes ? `<div class="muted small" style="margin-top:8px">${esc(g.notes)}</div>` : ''}
    <div class="row" style="margin-top:12px">
      ${g.type === 'custom' && g.target != null ? `<form class="row" data-form="goalVal" data-id="${g.id}"><input name="v" inputmode="decimal" placeholder="Nuovo valore" style="width:120px" required><button class="btn sm">Aggiorna</button></form>` : ''}
      ${g.type === 'custom' && g.target == null ? `<button class="btn sm" data-act="goalDone" data-id="${g.id}">${g.done ? '↺ Riapri' : '✓ Segna come fatto'}</button>` : ''}
      <span class="spacer"></span>
      <button class="btn sm ghost" data-act="goalArchive" data-id="${g.id}">${g.archived ? 'Riattiva' : 'Archivia'}</button>
      <button class="btn sm ghost danger" data-act="goalDel" data-id="${g.id}">Elimina</button>
    </div>
  </div>`;
}

function viewGoals() {
  const active = DB.goals.filter(g => !g.archived), archived = DB.goals.filter(g => g.archived);
  return `
  <div class="page-head"><h2>Obiettivi</h2></div>
  <div class="card">
    <h3 style="margin-bottom:12px">Nuovo obiettivo</h3>
    <form class="goal-form" data-form="goal" data-type="weight" autocomplete="off">
      <label class="field">Tipo<select name="type" data-bind="goalType">
        <option value="weight">Peso corporeo</option><option value="exercise">Carico esercizio</option><option value="custom">Personale</option></select></label>
      <label class="field only-ex">Esercizio<select name="exercise">${allExercises().map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
      <label class="field only-ex">Misura<select name="metric"><option value="top">Carico massimo</option><option value="e1rm">1RM stimato</option></select></label>
      <label class="field only-custom">Titolo<input name="title" placeholder="es. 10 trazioni senza assistenza"></label>
      <label class="field only-custom">Unità<input name="unit" placeholder="es. rep, km"></label>
      <label class="field">Obiettivo<input name="target" inputmode="decimal" placeholder="es. 75"></label>
      <label class="field">Scadenza<input type="date" name="deadline"></label>
      <label class="field only-custom">Valore attuale<input name="current" inputmode="decimal" placeholder="es. 4"></label>
      <button class="btn primary">Aggiungi</button>
    </form>
    <p class="faint small" style="margin:10px 0 0">Peso ed esercizi si aggiornano da soli con i dati che registri. Per un obiettivo personale senza numero, lascia vuoto "Obiettivo" e lo spunti quando è fatto.</p>
  </div>
  <div class="grid g2" style="margin-top:14px">${active.map(goalCard).join('')}</div>
  ${!active.length ? `<div class="card"><div class="empty">Nessun obiettivo attivo.</div></div>` : ''}
  ${archived.length ? `<details class="hist" style="margin-top:20px"><summary>Archiviati (${archived.length})</summary><div class="grid g2" style="margin-top:12px">${archived.map(goalCard).join('')}</div></details>` : ''}`;
}

/* ---------- Guida dieta ---------- */
// Confronto per parole, tollerando singolare/plurale (mela/mele, gambero/gamberi)
const stem = w => w.replace(/[aeiouàèéìòù]$/, '');
const words = s => norm(s).split(/[^a-zàèéìòù]+/).filter(w => w.length > 2).map(stem);
const containsAll = (hay, needle) => needle.length > 0 && needle.every(w => hay.includes(w));

// Restituisce la voce più specifica della guida che corrisponde al nome (es. "pasta di mais" batte "mais")
function dietCheck(name) {
  const D = DB.diet;
  if (!D || !name) return null;
  const q = words(name);
  let best = null;
  const consider = (status, label, note) => {
    const w = words(label);
    // Meglio una voce tutta contenuta nel nome (più parole = più specifica); altrimenti il nome dentro una voce (più corta = più vicina)
    const score = containsAll(q, w) ? 100 + w.length : containsAll(w, q) ? 50 - w.length : 0;
    if (score && (!best || score > best.score)) best = { status, label, note, score };
  };
  D.foods.ok.forEach(x => consider('ok', x));
  D.foods.limit.forEach(x => consider('limit', x.name, x.note));
  D.foods.avoid.forEach(x => consider('avoid', x));
  return best;
}

function parseTarget(t) {
  const s = String(t || '').trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d+)\s*-\s*(\d+)$/))) return { min: +m[1], max: +m[2] };
  if ((m = s.match(/^max\s*(\d+)$/))) return { min: null, max: +m[1] };
  if ((m = s.match(/^>\s*(\d+)$/))) return { min: +m[1] + 1, max: null };
  if ((m = s.match(/^(?:>=|≥|almeno)\s*(\d+)$/))) return { min: +m[1], max: null };
  if ((m = s.match(/^(\d+)$/))) return { min: +m[1], max: +m[1] };
  return { min: null, max: null };
}

function matchesKeyword(name, kw) {
  const n = norm(name), k = norm(kw);
  if (k.includes(' ')) return n.includes(k);
  return n.split(/[^a-zàèéìòù]+/).some(w => w === k || (w.startsWith(k) && w.length - k.length <= 1));
}

// Quante volte (pasti distinti) ogni fonte proteica compare nella settimana del giorno indicato
function freqCounts(date) {
  const ws = weekStart(date), we = addDays(ws, 6);
  const items = DB.foods.filter(f => f.date >= ws && f.date <= we);
  return (DB.diet?.freq || []).map(fr => {
    const hits = new Set();
    for (const f of items) if (fr.keywords.some(k => matchesKeyword(f.name, k))) hits.add(f.date + '|' + f.meal);
    return { ...fr, ...parseTarget(fr.target), n: hits.size };
  });
}

function freqCard(date) {
  const rows = freqCounts(date);
  if (!rows.length) return '';
  const ws = weekStart(date);
  return `
  <div class="card">
    <div class="card-head"><h3>Fonti proteiche della settimana</h3><span class="faint small">${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}</span></div>
    <div class="grid g3" style="gap:14px 22px">
      ${rows.map(r => {
        const cap = r.max ?? r.min ?? 1;
        const over = r.max != null && r.n > r.max, ok = !over && r.min != null && r.n >= r.min;
        return `<div class="meter"><div class="top"><span>${esc(r.label)}</span>
            <b>${r.n} <span class="faint">/ ${esc(r.target)}</span>${over ? ' ⚠' : ok ? ' ✓' : ''}</b></div>
          <div class="bar ${over ? 'over' : ok ? 'good' : ''}"><i style="width:${clamp01(r.n / cap) * 100}%"></i></div>
          ${r.portion ? `<div class="faint small" style="margin-top:3px">Porzione: ${esc(r.portion)}</div>` : ''}</div>`;
      }).join('')}
    </div>
    <p class="faint small" style="margin:12px 0 0">Calcolato da quello che registri in Cibo, riconoscendo le parole chiave (pollo, salmone, ceci…).</p>
  </div>`;
}

function dietResultHtml(q) {
  if (!q.trim()) return '';
  const r = dietCheck(q);
  if (!r) return `<div class="chip" style="margin-top:10px">Non è nella guida: chiedi alla nutrizionista o usa il buon senso</div>`;
  const map = { ok: ['good', '✓ Consentito'], limit: ['warn', '⚠ Con limite'], avoid: ['bad', '✕ Da evitare'] };
  const [cls, label] = map[r.status];
  return `<div class="row" style="margin-top:10px"><span class="chip ${cls}">${label}</span><span><b>${esc(r.label)}</b>${r.note ? ` · ${esc(r.note)}` : ''}</span></div>`;
}

const emptyDiet = () => ({ title: 'Piano alimentare', meals: [], rules: [], foods: { ok: [], limit: [], avoid: [] }, freq: [], todo: [] });

function viewDiet() {
  const D = DB.diet;
  if (!D) return `
    <div class="page-head"><h2>Guida dieta</h2></div>
    <div class="card"><div class="empty">
      Nessuna guida caricata.<br><br>
      <label class="btn primary">Importa guida (.json)<input type="file" accept=".json,application/json" data-bind="dietImport" hidden></label>
      <button class="btn" data-act="dietCreate">Crea da zero</button>
    </div></div>`;
  if (ui.dietEdit) return viewDietEdit(D);
  const chips = (list, cls) => list.map(x => `<span class="chip ${cls}">${esc(x.name ?? x)}${x.note ? ` <span style="opacity:.75">· ${esc(x.note)}</span>` : ''}</span>`).join(' ');
  return `
  <div class="page-head"><div><h2>Guida dieta</h2>${D.title ? `<div class="muted small">${esc(D.title)}</div>` : ''}</div>
    <button class="btn ghost" data-act="dietEdit">✏️ Modifica</button></div>

  <div class="card">
    <h3>Posso mangiarlo?</h3>
    <input data-bind="dietSearch" placeholder="Scrivi un alimento (es. pesche, zucchine, pasta di mais)" style="width:100%;margin-top:10px" autocomplete="off">
    <div id="dietResult"></div>
  </div>

  ${freqCard(today())}

  <div class="grid g3" style="margin-top:14px">
    <div class="card"><h3 style="margin-bottom:10px">✓ Consentiti</h3><div class="row" style="gap:6px">${chips(D.foods.ok, 'good') || '<span class="faint small">—</span>'}</div></div>
    <div class="card"><h3 style="margin-bottom:10px">⚠ Con limite</h3><div class="row" style="gap:6px">${chips(D.foods.limit, 'warn') || '<span class="faint small">—</span>'}</div></div>
    <div class="card"><h3 style="margin-bottom:10px">✕ Da evitare</h3><div class="row" style="gap:6px">${chips(D.foods.avoid, 'bad') || '<span class="faint small">—</span>'}</div></div>
  </div>

  ${D.meals.length ? `<div class="card" style="margin-top:14px"><h3 style="margin-bottom:4px">Schema dei pasti</h3>
    ${D.meals.map(m => `<div class="list-row" style="align-items:flex-start"><b style="min-width:110px">${esc(m.title)}</b><div class="muted" style="white-space:pre-line">${esc(m.text)}</div></div>`).join('')}</div>` : ''}

  ${D.rules.length ? `<div class="card"><h3 style="margin-bottom:6px">Indicazioni</h3>
    <ul style="margin:0;padding-left:18px" class="muted">${D.rules.map(r => `<li style="margin:5px 0">${esc(r)}</li>`).join('')}</ul></div>` : ''}

  ${D.todo.length ? `<div class="card"><h3 style="margin-bottom:6px">Da chiarire con la nutrizionista</h3>
    <ul style="margin:0;padding-left:18px" class="muted">${D.todo.map(r => `<li style="margin:5px 0">${esc(r)}</li>`).join('')}</ul></div>` : ''}`;
}

function viewDietEdit(D) {
  const ta = (name, value, rows = 6) => `<textarea name="${name}" rows="${rows}">${esc(value)}</textarea>`;
  return `
  <div class="page-head"><h2>Modifica guida</h2></div>
  <form data-form="diet" class="stack">
    <div class="card"><label class="field">Titolo<input name="title" value="${esc(D.title || '')}"></label></div>
    <div class="card"><h3>Schema dei pasti</h3><p class="faint small">Un pasto per blocco: prima riga <b>NOME:</b>, poi il testo. Separa i pasti con una riga vuota.</p>
      ${ta('meals', D.meals.map(m => `${m.title}:\n${m.text}`).join('\n\n'), 14)}</div>
    <div class="grid g3">
      <div class="card"><h3>Consentiti</h3><p class="faint small">Uno per riga.</p>${ta('ok', D.foods.ok.join('\n'), 12)}</div>
      <div class="card"><h3>Con limite</h3><p class="faint small">Uno per riga: <b>alimento | nota</b></p>${ta('limit', D.foods.limit.map(x => `${x.name} | ${x.note || ''}`).join('\n'), 12)}</div>
      <div class="card"><h3>Da evitare</h3><p class="faint small">Uno per riga.</p>${ta('avoid', D.foods.avoid.join('\n'), 12)}</div>
    </div>
    <div class="card"><h3>Frequenze settimanali</h3><p class="faint small">Una per riga: <b>nome | volte (es. 3-4, max 1, 2, >2) | porzione | parole chiave separate da virgola</b></p>
      ${ta('freq', D.freq.map(f => `${f.label} | ${f.target} | ${f.portion || ''} | ${f.keywords.join(', ')}`).join('\n'), 8)}</div>
    <div class="card"><h3>Indicazioni</h3><p class="faint small">Una per riga.</p>${ta('rules', D.rules.join('\n'), 8)}</div>
    <div class="card"><h3>Da chiarire</h3><p class="faint small">Una per riga.</p>${ta('todo', D.todo.join('\n'), 4)}</div>
    <div class="row"><button class="btn primary">Salva guida</button><button type="button" class="btn ghost" data-act="dietEdit">Annulla</button>
      <span class="spacer"></span><button type="button" class="btn ghost danger" data-act="dietDelete">Elimina guida</button></div>
  </form>`;
}

function parseDietForm(fd) {
  const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
  const meals = String(fd.meals || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
    const [first, ...rest] = b.split('\n');
    return { title: first.replace(/:\s*$/, '').trim(), text: rest.join('\n').trim() };
  });
  return {
    title: String(fd.title || '').trim(),
    meals,
    rules: lines(fd.rules),
    todo: lines(fd.todo),
    foods: {
      ok: lines(fd.ok),
      avoid: lines(fd.avoid),
      limit: lines(fd.limit).map(l => { const [name, note] = l.split('|').map(x => x.trim()); return { name, note: note || '' }; }),
    },
    freq: lines(fd.freq).map(l => {
      const [label, target, portion, kws] = l.split('|').map(x => (x || '').trim());
      return { label, target, portion, keywords: (kws || '').split(',').map(x => x.trim()).filter(Boolean) };
    }),
  };
}

async function importDiet(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const d = data.diet || data;
    if (!d.foods || !Array.isArray(d.freq)) throw new Error();
    DB.diet = Object.assign(emptyDiet(), d);
    save(); render(); toast('Guida importata');
  } catch { toast('File non valido'); }
}

/* ---------- Render ---------- */
const VIEWS = { dashboard: viewDashboard, allenamento: viewWorkout, alimentazione: viewFood, calendario: viewCalendar, progressi: viewProgress, obiettivi: viewGoals, dieta: viewDiet };

function render() {
  pendingCharts = [];
  const scroll = window.scrollY;
  $('#view').innerHTML = VIEWS[ui.view]();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === ui.view));
  $('#foodlist').innerHTML = Object.values(DB.foodLib).map(f => `<option value="${esc(f.name)}">`).join('');
  $('#exlist').innerHTML = allExercises().map(n => `<option value="${esc(n)}">`).join('');
  drawCharts();
  window.scrollTo(0, scroll);
}

function go(view) {
  if (ui.view === 'allenamento' && view !== 'allenamento' && ui.dirty && !confirm('Hai modifiche non salvate all\'allenamento. Uscire comunque?')) { location.hash = 'allenamento'; return; }
  if (view !== ui.view) ui.dirty = false, ui.draft = null;
  ui.view = view;
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== ui.view) go(v); });

/* ---------- Azioni ---------- */
function setWorkout(date, tplId) {
  if (ui.dirty && !confirm('Hai modifiche non salvate. Continuare?')) return;
  ui.wDate = date; ui.wTplId = tplId || tplForDate(date); ui.draft = null; ui.dirty = false;
}

const actions = {
  wRange: el => { ui.wRange = Number(el.dataset.v); render(); },
  metric: el => { ui.metric = el.dataset.v; render(); },
  goWorkout: el => { setWorkout(el.dataset.date, el.dataset.tpl); ui.editProgram = false; if (ui.view === 'allenamento') render(); else location.hash = 'allenamento'; },
  wDay: el => { setWorkout(addDays(ui.wDate, Number(el.dataset.n))); render(); },
  wToday: () => { setWorkout(today()); render(); },
  wTpl: el => { if (ui.dirty && !confirm('Hai modifiche non salvate. Continuare?')) return; ui.wTplId = el.dataset.id; ui.draft = null; ui.dirty = false; render(); },
  addSet: el => { const e = ui.draft.exercises[el.dataset.ei]; const l = e.sets[e.sets.length - 1]; e.sets.push({ kg: l?.kg ?? null, reps: null }); ui.dirty = true; render(); },
  rmSet: el => { ui.draft.exercises[el.dataset.ei].sets.pop(); ui.dirty = true; render(); },
  rmEx: el => { ui.draft.exercises.splice(el.dataset.ei, 1); ui.dirty = true; render(); },
  fillLast: el => {
    const e = ui.draft.exercises[el.dataset.ei], last = lastBefore(e.name, ui.wDate);
    if (!last) return;
    e.sets = last.ex.sets.map(s => ({ kg: s.kg, reps: s.reps }));
    ui.dirty = true; render();
  },
  saveWorkout: () => {
    const d = ui.draft;
    const exercises = d.exercises.map(e => ({ name: e.name, unit: e.unit, sets: e.sets.filter(s => s.kg != null || s.reps != null) })).filter(e => e.sets.length);
    if (!exercises.length) return toast('Inserisci almeno una serie');
    const session = { id: d.existingId || uid(), date: d.date, templateId: d.templateId, name: d.name, exercises, notes: d.notes || '' };
    const i = DB.sessions.findIndex(s => s.id === session.id);
    if (i >= 0) DB.sessions[i] = session; else DB.sessions.push(session);
    ui.draft = null; ui.dirty = false;
    save(); render(); toast('Allenamento salvato 💪');
  },
  delWorkout: () => {
    if (!confirm('Eliminare questo allenamento?')) return;
    DB.sessions = DB.sessions.filter(s => s.id !== ui.draft.existingId);
    ui.draft = null; ui.dirty = false; save(); render(); toast('Allenamento eliminato');
  },
  editProgram: () => { if (!ui.editProgram && ui.dirty && !confirm('Hai modifiche non salvate. Continuare?')) return; ui.editProgram = !ui.editProgram; ui.draft = null; ui.dirty = false; render(); },
  addPex: el => { DB.program[el.dataset.di].exercises.push(mkEx('Nuovo esercizio', 'kg', 3)); save(); render(); },
  rmPex: el => { DB.program[el.dataset.di].exercises.splice(el.dataset.xi, 1); save(); render(); },
  mvPex: el => { const a = DB.program[el.dataset.di].exercises, i = Number(el.dataset.xi); [a[i - 1], a[i]] = [a[i], a[i - 1]]; save(); render(); },
  addDay: () => { DB.program.push({ id: uid(), weekday: 1, name: 'NUOVO', exercises: [] }); save(); render(); },
  rmDay: el => { if (!confirm('Eliminare questo giorno dalla scheda? Lo storico resta.')) return; DB.program.splice(el.dataset.di, 1); save(); render(); },
  resetProgram: () => { if (!confirm('Ripristinare la scheda iniziale? Lo storico resta.')) return; DB.program = defaultProgram(); save(); render(); },

  fDay: el => { ui.fDate = addDays(ui.fDate, Number(el.dataset.n)); render(); },
  fToday: () => { ui.fDate = today(); render(); },
  quickFood: el => {
    const f = DB.foodLib[el.dataset.key]; if (!f) return;
    const meal = el.closest('main').querySelector('form[data-form="food"] select[name="meal"]')?.value || defaultMeal();
    addFood(el.dataset.date, { name: f.name, qty: f.qty, kcal: f.kcal, p: f.p, c: f.c, f: f.f, meal });
  },
  rmFood: el => { DB.foods = DB.foods.filter(f => f.id !== el.dataset.id); save(); render(); },
  copyFoods: el => {
    const date = el.dataset.date, prev = foodsOn(addDays(date, -1));
    if (!prev.length) return toast('Il giorno prima è vuoto');
    DB.foods.push(...prev.map(f => ({ ...f, id: uid(), date })));
    save(); render(); toast(`Copiati ${prev.length} alimenti`);
  },

  calMonth: el => { const [y, m] = ui.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + Number(el.dataset.n), 1); ui.calMonth = iso(d).slice(0, 7); render(); },
  calToday: () => { ui.calMonth = today().slice(0, 7); ui.calSel = today(); render(); },
  calSel: el => { ui.calSel = el.dataset.date; if (ui.calSel.slice(0, 7) !== ui.calMonth) ui.calMonth = ui.calSel.slice(0, 7); render(); },
  rmWeight: el => { DB.weights = DB.weights.filter(w => w.date !== el.dataset.date); save(); render(); },

  goalDone: el => { const g = DB.goals.find(x => x.id === el.dataset.id); g.done = !g.done; g.achievedAt = g.done ? today() : undefined; save(); render(); },
  goalArchive: el => { const g = DB.goals.find(x => x.id === el.dataset.id); g.archived = !g.archived; save(); render(); },
  goalDel: el => { if (!confirm('Eliminare questo obiettivo?')) return; DB.goals = DB.goals.filter(x => x.id !== el.dataset.id); save(); render(); },

  dietEdit: () => { ui.dietEdit = !ui.dietEdit; render(); window.scrollTo(0, 0); },
  dietCreate: () => { DB.diet = emptyDiet(); ui.dietEdit = true; save(); render(); },
  dietDelete: () => { if (!confirm('Eliminare la guida dieta?')) return; DB.diet = null; ui.dietEdit = false; save(); render(); },
  logout: () => { try { localStorage.removeItem(PW_KEY); } catch { /* storage non disponibile */ } location.reload(); },
  export: () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tracker-backup-${today()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  },
};

function addFood(date, f) {
  DB.foods.push({ id: uid(), date, ...f });
  const k = norm(f.name), prev = DB.foodLib[k];
  DB.foodLib[k] = { name: f.name, qty: f.qty, kcal: f.kcal, p: f.p, c: f.c, f: f.f, count: (prev?.count || 0) + 1 };
  save(); render();
  const dc = dietCheck(f.name);
  if (dc?.status === 'avoid') toast(`⚠ ${f.name} aggiunto, ma la guida dice di evitarlo`, 3500);
  else if (dc?.status === 'limit') toast(`${f.name} aggiunto · ${dc.note || 'con limite'}`, 3500);
  else toast(`${f.name} aggiunto`);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  e.preventDefault();
  actions[el.dataset.act]?.(el);
});

document.addEventListener('submit', e => {
  const form = e.target, fd = Object.fromEntries(new FormData(form));
  e.preventDefault();
  switch (form.dataset.form) {
    case 'weight': {
      const kg = num(fd.kg); if (kg == null) return;
      DB.weights = DB.weights.filter(w => w.date !== fd.date);
      DB.weights.push({ date: fd.date, kg });
      save(); render(); toast('Peso registrato');
      break;
    }
    case 'food': {
      const name = fd.name.trim(); if (!name) return;
      addFood(form.dataset.date, { name, qty: num(fd.qty), kcal: num(fd.kcal), p: num(fd.p), c: num(fd.c), f: num(fd.f), meal: fd.meal });
      $('form[data-form="food"] input[name="name"]')?.focus();
      break;
    }
    case 'addEx': {
      const name = fd.name.trim(); if (!name) return;
      const unit = exUnit(name), last = history(name).pop();
      const n = last?.ex.sets.length || 3;
      ui.draft.exercises.push({ name: allExercises().find(x => norm(x) === norm(name)) || name, unit, sets: Array.from({ length: n }, () => ({ kg: null, reps: null })) });
      ui.dirty = true; render();
      break;
    }
    case 'goal': {
      const g = { id: uid(), type: fd.type, target: num(fd.target), deadline: fd.deadline || null, createdAt: today() };
      if (g.type === 'exercise') { g.exercise = fd.exercise; g.metric = fd.metric; if (!g.exercise) return toast('Scegli un esercizio'); }
      if (g.type === 'custom') { g.title = fd.title.trim(); g.unit = fd.unit.trim(); g.current = num(fd.current); g.start = g.current; if (!g.title) return toast('Dai un titolo all\'obiettivo'); }
      if (g.type !== 'custom' && g.target == null) return toast('Inserisci il valore obiettivo');
      if (g.type !== 'custom') g.start = goalCurrent(g);
      DB.goals.unshift(g); save(); render(); toast('Obiettivo aggiunto 🎯');
      break;
    }
    case 'diet': {
      DB.diet = parseDietForm(fd);
      ui.dietEdit = false; save(); render(); window.scrollTo(0, 0); toast('Guida salvata');
      break;
    }
    case 'goalVal': {
      const g = DB.goals.find(x => x.id === form.dataset.id), v = num(fd.v);
      if (v == null) return;
      g.current = v;
      if (g.start == null) g.start = v;
      g.achievedAt = goalProgress(g) >= 1 ? (g.achievedAt || today()) : undefined;
      save(); render();
      break;
    }
  }
});

// Input senza re-render (per non perdere il focus mentre si scrive)
document.addEventListener('input', e => {
  const el = e.target, b = el.dataset.bind;
  if (b === 'set') { ui.draft.exercises[el.dataset.ei].sets[el.dataset.si][el.dataset.f] = num(el.value); ui.dirty = true; }
  else if (b === 'wNotes') { ui.draft.notes = el.value; ui.dirty = true; }
  else if (b === 'dayNote') { if (el.value.trim()) DB.notes[el.dataset.date] = el.value; else delete DB.notes[el.dataset.date]; save(); }
  else if (b === 'setting') { const v = num(el.value); if (v != null) { DB.settings[el.dataset.k] = v; save(); } }
  else if (b === 'pName') { DB.program[el.dataset.di].name = el.value; save(); }
  else if (b === 'dietSearch') $('#dietResult').innerHTML = dietResultHtml(el.value);
  else if (el.name === 'name' && el.form?.dataset.form === 'food') autofillFood(el.form);
  else if (el.name === 'qty' && el.form?.dataset.form === 'food') scaleFood(el.form);
});

document.addEventListener('change', e => {
  const el = e.target, b = el.dataset.bind;
  if (b === 'wDate' && el.value) { setWorkout(el.value); render(); }
  else if (b === 'fDate' && el.value) { ui.fDate = el.value; render(); }
  else if (b === 'pDay') { DB.program[el.dataset.di].weekday = Number(el.value); save(); }
  else if (b === 'pEx') { const x = DB.program[el.dataset.di].exercises[el.dataset.xi]; x[el.dataset.f] = el.dataset.f === 'sets' ? Math.max(1, Number(el.value) || 1) : el.value.trim(); save(); }
  else if (b === 'goalType') el.form.dataset.type = el.value;
  else if (b === 'import') importFile(el.files[0]);
  else if (b === 'dietImport') importDiet(el.files[0]);
});

const fld = (form, k) => form.querySelector(`[name="${k}"]`);

// Scegliendo un cibo già usato, i valori si compilano da soli
function autofillFood(form) {
  const f = DB.foodLib[norm(fld(form, 'name').value)];
  if (!f) return;
  for (const k of ['qty', 'kcal', 'p', 'c', 'f']) fld(form, k).value = f[k] ?? '';
}
// Cambiando i grammi, le macro vengono riproporzionate
function scaleFood(form) {
  const f = DB.foodLib[norm(fld(form, 'name').value)], q = num(fld(form, 'qty').value);
  if (!f || !f.qty || q == null) return;
  const r = q / f.qty;
  for (const k of ['kcal', 'p', 'c', 'f']) if (f[k] != null) fld(form, k).value = Math.round(f[k] * r * 10) / 10;
}

async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.sessions)) throw new Error();
    if (!confirm('Sostituire tutti i dati attuali con quelli del backup?')) return;
    DB = Object.assign(defaultDB(), data);
    save(); render(); toast('Backup importato');
  } catch { toast('File non valido'); }
}

/* ---------- Avvio ---------- */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
load().then(ok => {
  if (!ok) return;
  const v = location.hash.slice(1);
  ui.view = VIEWS[v] ? v : 'dashboard';
  setStatus(mode === 'server' ? 'Salvato ✓' : 'Salvato nel browser');
  render();
});
