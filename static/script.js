/* ---------- Theme toggle ---------- */
const root = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const iconDark = document.getElementById('theme-icon-dark');
const iconLight = document.getElementById('theme-icon-light');

function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  iconDark.classList.toggle('hidden', theme === 'light');
  iconLight.classList.toggle('hidden', theme === 'dark');
  localStorage.setItem('rsi-theme', theme);
}
applyTheme(localStorage.getItem('rsi-theme') || 'dark');
themeToggle.addEventListener('click', () => {
  const current = root.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'history') renderHistory();
  });
});

/* ---------- Sliders: live readout ---------- */
document.querySelectorAll('input[type="range"]').forEach((input) => {
  const out = document.getElementById(`${input.id}-out`);
  const sync = () => { out.textContent = input.value; };
  input.addEventListener('input', sync);
  sync();
});

/* ---------- Icon button groups ---------- */
document.querySelectorAll('.btn-group').forEach((group) => {
  const hiddenInput = document.getElementById(group.dataset.input);
  const valueMap = group.dataset.map ? JSON.parse(group.dataset.map) : null;

  group.querySelectorAll('.opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const rawValue = btn.dataset.value;
      hiddenInput.value = valueMap ? valueMap[rawValue] : rawValue;
    });
  });
});

/* ---------- Form submit ---------- */
const form = document.getElementById('rsi-form');
const submitBtn = document.getElementById('submit-btn');
const emptyEl = document.getElementById('result-empty');
const loadingEl = document.getElementById('result-loading');
const contentEl = document.getElementById('result-content');
const errorEl = document.getElementById('result-error');

let lastResult = null; // kept for Export Report

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  emptyEl.classList.add('hidden');
  contentEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    renderResult(data, payload);
    saveToHistory(data);
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- Bucket binary probabilities into Low / Medium / High ----------
   The trained model only outputs Low or High. "Medium" here is a derived
   confidence band around the decision boundary (P(High) between 35% and 65%),
   not a separately trained class. */
function bucketRisk(probHigh) {
  if (probHigh < 0.35) return 'Low';
  if (probHigh < 0.65) return 'Medium';
  return 'High';
}

const RISK_FACTOR_RULES = [
  { key: 'DailySittingHours', test: (v) => parseFloat(v) >= 8, text: 'Long daily sitting hours (8h+)' },
  { key: 'Posture', test: (v) => v === 'Poor', text: 'Poor sitting posture' },
  { key: 'PainLevel', test: (v) => parseFloat(v) >= 6, text: 'High pain level' },
  { key: 'BreakCountPerDay', test: (v) => parseFloat(v) <= 2, text: 'Low breaks per day (≤2)' },
  { key: 'DoesStretching', test: (v) => v === 'No', text: 'No regular stretching' },
  { key: 'TypingHoursPerDay', test: (v) => parseFloat(v) >= 7, text: 'High typing hours per day' },
  { key: 'SleepHours', test: (v) => parseFloat(v) < 6, text: 'Insufficient sleep (<6h)' },
];

const RECOMMENDATION_RULES = [
  { key: 'BreakCountPerDay', test: (v) => parseFloat(v) <= 2, text: 'Take a break every 45 minutes' },
  { key: 'DoesStretching', test: (v) => v === 'No', text: 'Do stretching exercises daily' },
  { key: 'Posture', test: (v) => v === 'Poor', text: 'Improve your sitting posture' },
  { key: 'KeyboardType', test: (v) => v === 'Standard', text: 'Use an ergonomic keyboard' },
  { key: 'SleepHours', test: (v) => parseFloat(v) < 7, text: 'Get 7-8 hours of sleep daily' },
  { key: 'DailySittingHours', test: (v) => parseFloat(v) >= 8, text: 'Reduce continuous sitting time' },
];

function buildFactorsAndRecs(payload) {
  const factors = RISK_FACTOR_RULES.filter((r) => r.test(payload[r.key])).map((r) => r.text);
  const recs = RECOMMENDATION_RULES.filter((r) => r.test(payload[r.key])).map((r) => r.text);
  if (factors.length === 0) factors.push('No major risk factors detected in your current habits');
  if (recs.length === 0) recs.push('Keep up your current healthy routine');
  return { factors, recs };
}

function setGaugeNeedle(pct) {
  // gauge spans -90deg (0%) to +90deg (100%) around pivot (100,110)
  const angle = -90 + (pct / 100) * 180;
  document.getElementById('gauge-needle').setAttribute('transform', `rotate(${angle} 100 110)`);
}

function setDonut(pct) {
  const circumference = 2 * Math.PI * 42; // ~264
  const offset = circumference - (pct / 100) * circumference;
  document.getElementById('donut-fill').style.strokeDashoffset = offset;
}

function renderResult(data, payload) {
  lastResult = { data, payload, timestamp: Date.now() };

  const probHigh = data.probabilities.High ?? 0;
  const probLow = data.probabilities.Low ?? 0;
  const bucket = bucketRisk(probHigh);
  const bucketClass = bucket.toLowerCase();
  const pct = Math.round(probHigh * 100);
  const confidencePct = Math.round(Math.max(probHigh, probLow) * 100);

  const levelText = document.getElementById('risk-level-text');
  levelText.textContent = `${bucket.toUpperCase()} RISK`;
  levelText.className = `risk-level-text ${bucketClass}`;

  document.getElementById('gauge-pct').textContent = `${pct}%`;
  setGaugeNeedle(pct);
  document.getElementById('gauge-footnote').textContent =
    `Model output: ${data.risk_level} risk (P(High) = ${pct}%). Displayed as ${bucket} using the confidence band.`;

  document.getElementById('donut-pct').textContent = `${confidencePct}%`;
  setDonut(confidencePct);
  const confBadge = document.getElementById('confidence-badge');
  const confLevel = confidencePct >= 75 ? 'High' : confidencePct >= 55 ? 'Medium' : 'Low';
  confBadge.textContent = confLevel;
  confBadge.className = `confidence-badge ${confLevel.toLowerCase()}`;

  const { factors, recs } = buildFactorsAndRecs(payload);
  const factorsList = document.getElementById('risk-factors-list');
  factorsList.innerHTML = factors.map((f) => `<li><span class="dot-warn"></span>${f}</li>`).join('');
  const recsList = document.getElementById('recommendations-list');
  recsList.innerHTML = recs.map((r) => `<li><span class="dot-good"></span>${r}</li>`).join('');

  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
}

/* ---------- History (stored locally in the browser only) ---------- */
const HISTORY_KEY = 'rsi-history';

function saveToHistory(data) {
  const probHigh = data.probabilities.High ?? 0;
  const entry = {
    date: new Date().toISOString(),
    probHigh,
    bucket: bucketRisk(probHigh),
  };
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  history.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-20)));
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  const emptyEl2 = document.getElementById('history-empty');
  const chartWrap = document.getElementById('history-chart-wrap');
  const tableEl = document.getElementById('history-table');
  const clearBtn = document.getElementById('clear-history-btn');

  if (history.length === 0) {
    emptyEl2.classList.remove('hidden');
    chartWrap.classList.add('hidden');
    tableEl.innerHTML = '';
    clearBtn.classList.add('hidden');
    return;
  }

  emptyEl2.classList.add('hidden');
  chartWrap.classList.remove('hidden');
  clearBtn.classList.remove('hidden');

  const svg = document.getElementById('trend-svg');
  const w = 600, h = 220, pad = 30;
  const points = history.map((entry, i) => {
    const x = pad + (i / Math.max(history.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - entry.probHigh * (h - pad * 2);
    return { x, y, entry };
  });
  const colorFor = (b) => (b === 'Low' ? 'var(--low)' : b === 'Medium' ? 'var(--medium)' : 'var(--high)');
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  svg.innerHTML = `
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--panel-border)" />
    <path d="${linePath}" fill="none" stroke="var(--primary-1)" stroke-width="2" />
    ${points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${colorFor(p.entry.bucket)}" />`).join('')}
  `;

  const rows = history.slice().reverse().map((entry) => `
    <tr>
      <td>${new Date(entry.date).toLocaleString()}</td>
      <td>${Math.round(entry.probHigh * 100)}%</td>
      <td>${entry.bucket}</td>
    </tr>
  `).join('');
  tableEl.innerHTML = `<table><thead><tr><th>Date</th><th>P(High)</th><th>Level</th></tr></thead><tbody>${rows}</tbody></table>`;
}

document.getElementById('clear-history-btn').addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

/* ---------- Export report (client-side, no server round trip) ---------- */
document.getElementById('export-btn').addEventListener('click', () => {
  if (!lastResult) {
    alert('Run a prediction first, then export the report.');
    return;
  }
  const { data, payload, timestamp } = lastResult;
  const probHigh = data.probabilities.High ?? 0;
  const bucket = bucketRisk(probHigh);

  const lines = [
    'PROGRAMMER RSI RISK REPORT',
    `Generated: ${new Date(timestamp).toLocaleString()}`,
    '',
    `Risk level: ${bucket} (model output: ${data.risk_level})`,
    `P(High risk): ${Math.round(probHigh * 100)}%`,
    `Risk score (RiskScore feature): ${data.risk_score}`,
    '',
    'Inputs:',
    ...Object.entries(payload).map(([k, v]) => `  - ${k}: ${v}`),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rsi-risk-report-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});
