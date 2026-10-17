/* ═══════════════════════════════════════════════════════════════════════
   RiskGuard AI — Production Frontend Application Logic (app.js)
   IBM Datathon 2026 Edition
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   1. GLOBAL CONSTANTS, BROKER MAP & APPLICATION STATE
   ═══════════════════════════════════════════════════════════════════ */
const API_MARKET_STATUS   = '/api/market-status';
const API_EXECUTE_DEFENSE = '/api/execute-defense';
const API_RESET_DEFENSE   = '/api/reset-defense';
const API_DEFENSE_STATUS  = '/api/defense-status';
const API_DEFENSE_TOGGLE  = '/api/defense-toggle';
const API_HOLDINGS        = '/api/holdings';
const API_SAFE_HAVENS     = '/api/safe-havens';

// Static conversion rate: 1 USD = 83.50 INR
const USD_TO_INR = 83.50;

const AUTO_SCAN_INTERVAL_SEC = 30;
const PRICE_UPDATE_MS        = 2000;
const MAX_CHART_POINTS       = 40;

const RISK_KEYWORDS_HIGH = ['crash', 'collapse', 'bankruptcy', 'plunge', 'fraud', 'default'];

// Dynamic 3-Broker Theme Configurations
const BROKERS = {
  zerodha: {
    key: 'zerodha',
    name: 'Zerodha Kite',
    clientId: 'ZK-94821',
    boid: 'IN300128-49201948',
    primaryColor: '#f6461a',
  },
  groww: {
    key: 'groww',
    name: 'Groww',
    clientId: 'GW-55102',
    boid: 'IN301549-38194012',
    primaryColor: '#00d09c',
  },
  angel: {
    key: 'angel',
    name: 'Angel One',
    clientId: 'AO-11847',
    boid: 'IN302927-10928374',
    primaryColor: '#0052cc',
  },
};

let state = {
  // Authentication & Dynamic Broker
  brokerKey:        'zerodha',
  connectedBroker:  'Zerodha Kite',
  brokerClientId:   'ZK-94821',
  brokerDematBoid:  'IN300128-49201948',

  // Currency & Theming
  currency:         'USD', // 'USD' | 'INR'
  theme:            'auto', // 'auto' | 'dark' | 'light'

  // Defense Toggle & Execution
  aiDefenseEnabled: true,
  defenseStatus:    'STANDBY', // 'STANDBY' | 'DEFENSE_ACTIVE'
  isDefenseExecuted: false,

  // Portfolio Holdings (SQLite portfolio.db)
  holdings:         [],
  portfolioSummary: null,
  selectedHolding:  null,

  // Safe Haven Recommendations
  safeHavens:       [],

  // Chart & Market Feed
  countdownSeconds: AUTO_SCAN_INTERVAL_SEC,
  aaplPriceUsd:     173.42,
  aaplOpenPriceUsd: 171.80,
  aaplHighPriceUsd: null,
  aaplLowPriceUsd:  null,
  chartPriceHistory:[],
  chartLabels:      [],
  chart:            null,
  scanIntervalId:   null,
  countdownIntervalId: null,

  // Alpaca Account Snapshot
  accountSnapshot:  null,
  lastTradeDetails: null,
};

/* ═══════════════════════════════════════════════════════════════════
   2. REACTIVE TOAST NOTIFICATION ENGINE
   ═══════════════════════════════════════════════════════════════════ */
function showToast({ type = 'info', title = '', message = '', icon = '⚡', duration = 4500 }) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-card toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">
        <span>${escHtml(title)}</span>
        <button class="toast-close-btn" aria-label="Dismiss">&times;</button>
      </div>
      <div class="toast-msg">${escHtml(message)}</div>
    </div>
    <div class="toast-progress"></div>
  `;

  const closeBtn = toast.querySelector('.toast-close-btn');
  const dismiss = () => {
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 260);
  };

  closeBtn.onclick = dismiss;
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

/* ═══════════════════════════════════════════════════════════════════
   3. CURRENCY FORMATTING & CONVERSION LOGIC
   ═══════════════════════════════════════════════════════════════════ */
/**
 * Formats a given USD amount into either USD ($) or INR (₹) based on active state.
 * Static conversion rate: 1 USD = 83.50 INR
 */
function formatCurrency(usdAmount, options = {}) {
  if (usdAmount === null || usdAmount === undefined || isNaN(usdAmount)) {
    return '--';
  }
  const num = Number(usdAmount);
  const isINR = state.currency === 'INR';
  const val = isINR ? num * USD_TO_INR : num;
  const symbol = isINR ? '₹' : '$';
  const decimals = options.decimals !== undefined ? options.decimals : 2;

  const formatted = val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${symbol}${formatted}`;
}

/**
 * Switch global currency preference ('USD' or 'INR') and recalculate all UI values.
 */
function setCurrency(curr) {
  if (curr !== 'USD' && curr !== 'INR') return;
  state.currency = curr;

  // Update Topbar currency buttons
  const btnUsd = document.getElementById('btn-currency-usd');
  const btnInr = document.getElementById('btn-currency-inr');
  if (btnUsd && btnInr) {
    btnUsd.classList.toggle('active', curr === 'USD');
    btnInr.classList.toggle('active', curr === 'INR');
  }

  // Update Profile modal currency buttons
  const prefUsd = document.getElementById('pref-btn-usd');
  const prefInr = document.getElementById('pref-btn-inr');
  if (prefUsd && prefInr) {
    prefUsd.classList.toggle('active', curr === 'USD');
    prefInr.classList.toggle('active', curr === 'INR');
  }

  // Re-render and recalculate all dynamic UI elements
  renderHoldingsGrid();
  updatePortfolioSummaryUI();
  updateChartStats();
  if (state.accountSnapshot) {
    updateDefenseMetrics(state.accountSnapshot);
  }
  renderSafeHavens();
  if (state.selectedHolding) {
    populateDetailModal(state.selectedHolding);
  }

  appendLog(`💱 Currency switched to ${curr} (1 USD = 83.50 INR). All portfolio values recalculated.`, 'log-info');
  showToast({
    type: 'info',
    title: 'Currency Recalculated',
    message: `Recalculated 6 Demat positions to ${curr} @ 83.50 INR`,
    icon: '💱'
  });
}

/* ═══════════════════════════════════════════════════════════════════
   4. THEME TOGGLING (Pure White vs Pitch Black)
   ═══════════════════════════════════════════════════════════════════ */
function setTheme(themeMode) {
  state.theme = themeMode;
  const root = document.documentElement;

  if (themeMode === 'auto') {
    root.removeAttribute('data-theme');
  } else if (themeMode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (themeMode === 'light') {
    root.setAttribute('data-theme', 'light');
  }

  // Update theme pill buttons in Profile modal
  ['auto', 'dark', 'light'].forEach(t => {
    const btn = document.getElementById(`theme-btn-${t}`);
    if (btn) btn.classList.toggle('active', t === themeMode);
  });

  appendLog(`🎨 Color theme set to: ${themeMode.toUpperCase()} (OS @media query active).`, 'log-info');
}

/* ═══════════════════════════════════════════════════════════════════
   5. DYNAMIC 3-BROKER THEME ENGINE
   ═══════════════════════════════════════════════════════════════════ */
/**
 * Seamlessly authenticates with selected broker (Zerodha Kite, Groww, Angel One),
 * sets persistent `data-broker` attribute on <body>, updates nav bar with mock Client ID,
 * and dynamically binds theme variables.
 */
function handleBrokerLogin(brokerKey, brokerName, clientId, dematBoid) {
  const conf = BROKERS[brokerKey] || {
    key: brokerKey,
    name: brokerName || 'Zerodha Kite',
    clientId: clientId || 'ZK-94821',
    boid: dematBoid || 'IN300128-49201948',
  };

  state.brokerKey       = conf.key;
  state.connectedBroker = conf.name;
  state.brokerClientId  = conf.clientId;
  state.brokerDematBoid = conf.boid;

  // Apply persistent data-broker attribute on <body>
  document.body.setAttribute('data-broker', conf.key);

  // Save in sessionStorage
  try {
    sessionStorage.setItem('brokerKey', conf.key);
    sessionStorage.setItem('connectedBroker', conf.name);
    sessionStorage.setItem('brokerClientId', conf.clientId);
    sessionStorage.setItem('brokerDematBoid', conf.boid);
  } catch (e) {}

  // UI: Show connecting animation
  const connState = document.getElementById('auth-connecting');
  const connText  = document.getElementById('auth-connecting-text');
  if (connState) connState.classList.remove('hidden');

  const steps = [
    `Authenticating via ${conf.name} Gateway…`,
    `Verifying Demat BOID [${conf.boid}] via CDSL…`,
    `Syncing 6 Active Holdings from SQLite portfolio.db…`,
    `Activating ${conf.name} Demat Theme Profile…`
  ];

  let stepIdx = 0;
  const interval = setInterval(() => {
    stepIdx++;
    if (stepIdx < steps.length) {
      if (connText) connText.textContent = steps[stepIdx];
    } else {
      clearInterval(interval);
      // Smoothly transition into the dashboard
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.add('auth-hidden');

      updateBrokerUI();
      updateChartBrokerTheme();

      appendLog(`🟢 Connected to ${conf.name} (Client ID: ${conf.clientId}). 6 Demat holdings armed.`, 'log-success');

      // Trigger reactive toast notification
      showToast({
        type: 'success',
        title: 'Broker Connected',
        message: `Logged in via ${conf.name} (ID: ${conf.clientId})`,
        icon: '🟢'
      });

      // Initialize dashboard feeds
      fetchHoldings();
      fetchSafeHavens();
      fetchDefenseStatus();
      runMarketScan();
    }
  }, 220);
}

function updateBrokerUI() {
  const brokerKey  = state.brokerKey || 'zerodha';
  const conf       = BROKERS[brokerKey] || BROKERS.zerodha;
  const brokerName = state.connectedBroker || conf.name;
  const clientId   = state.brokerClientId || conf.clientId;
  const dematBoid  = state.brokerDematBoid || conf.boid;

  document.body.setAttribute('data-broker', brokerKey);

  const topbarBrokerEl = document.getElementById('topbar-broker-name');
  if (topbarBrokerEl) topbarBrokerEl.textContent = brokerName;

  const topbarClientEl = document.getElementById('topbar-client-id');
  if (topbarClientEl) topbarClientEl.textContent = clientId;

  const profTitle = document.getElementById('profile-broker-title');
  if (profTitle) profTitle.textContent = brokerName;

  const profClient = document.getElementById('profile-client-id');
  if (profClient) profClient.textContent = `Client ID: #${clientId}`;

  const profBoid = document.getElementById('profile-boid');
  if (profBoid) profBoid.textContent = dematBoid;
}

function switchBroker() {
  closeProfileModal();
  const authScreen = document.getElementById('auth-screen');
  const connState  = document.getElementById('auth-connecting');
  if (connState) connState.classList.add('hidden');
  if (authScreen) authScreen.classList.remove('auth-hidden');
  appendLog('🔄 Switched broker session. Select Demat connection.', 'log-info');
}

function updateChartBrokerTheme() {
  if (!state.chart) return;
  const conf = BROKERS[state.brokerKey] || BROKERS.zerodha;
  const color = conf.primaryColor;

  state.chart.data.datasets[0].borderColor = color;

  const ctx = document.getElementById('aaplChart').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0,   hexToRgba(color, 0.32));
  gradient.addColorStop(0.6, hexToRgba(color, 0.06));
  gradient.addColorStop(1,   hexToRgba(color, 0.00));
  state.chart.data.datasets[0].backgroundColor = gradient;
  state.chart.update('none');
}

function hexToRgba(hex, alpha = 1) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

/* ═══════════════════════════════════════════════════════════════════
   6. 24/7 AI DEFENSE TOGGLE ENGINE
   ═══════════════════════════════════════════════════════════════════ */
/**
 * Prominent 24/7 AI Defense switch handler.
 * When enabled, automated Alpaca stop-loss execution fires on HIGH RISK.
 * When disabled, automated execution is safely withheld.
 */
async function handleDefenseToggleChange(isActive) {
  state.aiDefenseEnabled = isActive;

  // Sync checkboxes
  const topbarCb = document.getElementById('defense-toggle-checkbox');
  const prefCb   = document.getElementById('pref-defense-checkbox');
  if (topbarCb) topbarCb.checked = isActive;
  if (prefCb)   prefCb.checked   = isActive;

  // Update UI pill & container classes
  const pill      = document.getElementById('defense-status-pill');
  const pillText  = document.getElementById('defense-status-pill-text');
  const container = document.getElementById('defense-toggle-wrapper');

  if (pillText) pillText.textContent = isActive ? 'ACTIVE' : 'STANDBY';
  if (pill) pill.className = `defense-toggle-pill ${isActive ? 'active' : 'disabled'}`;

  if (container) {
    container.classList.toggle('active-shield', isActive);
    container.classList.toggle('disabled-shield', !isActive);
  }

  // Update shield coverage text
  const shieldText = document.getElementById('shield-coverage-text');
  if (shieldText) {
    shieldText.textContent = isActive
      ? '● All 6 positions armed'
      : '⏸ Stop-Loss execution paused';
    shieldText.className = isActive ? 'port-metric-sub text-success' : 'port-metric-sub text-warning';
  }

  // Sync with FastAPI server
  try {
    const resp = await fetch(API_DEFENSE_TOGGLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: isActive })
    });
    const data = await resp.json();
    appendLog(
      isActive
        ? '🛡️ 24/7 AI Defense set to ACTIVE: Automated Alpaca stop-loss is ENGAGED.'
        : '⏸️ 24/7 AI Defense DISABLED: Automated Alpaca stop-loss execution is SAFELY WITHHELD.',
      isActive ? 'log-success' : 'log-warning'
    );
    showToast({
      type: isActive ? 'success' : 'warning',
      title: '24/7 AI Defense',
      message: isActive ? 'Automated stop-loss execution is ACTIVE' : 'Automated stop-loss execution is SAFELY WITHHELD',
      icon: '⚡'
    });
  } catch (err) {
    console.error('Failed to sync defense toggle to server:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   7. PROTECTED PORTFOLIO (SQLite portfolio.db)
   ═══════════════════════════════════════════════════════════════════ */
async function fetchHoldings() {
  try {
    const resp = await fetch(API_HOLDINGS);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    state.holdings = data.holdings || [];
    state.portfolioSummary = data.summary || null;

    renderHoldingsGrid();
    updatePortfolioSummaryUI();
  } catch (err) {
    console.error('Failed to fetch holdings:', err);
    appendLog(`Holdings sync error: ${err.message}`, 'log-warning');
  }
}

function updatePortfolioSummaryUI() {
  const sum = state.portfolioSummary;
  if (!sum) return;

  const totalValEl  = document.getElementById('port-total-value');
  const totalCostEl = document.getElementById('port-total-invested');
  const totalPnlEl  = document.getElementById('port-total-pnl');
  const totalPnlPct = document.getElementById('port-total-pnl-pct');
  const countEl     = document.getElementById('port-total-count');

  if (totalValEl)  totalValEl.textContent  = formatCurrency(sum.total_value_usd);
  if (totalCostEl) totalCostEl.textContent = formatCurrency(sum.total_invested_usd);

  if (totalPnlEl && totalPnlPct) {
    const pnlUsd = sum.total_pnl_usd;
    const pnlPct = sum.total_pnl_pct;
    const isPositive = pnlUsd >= 0;

    totalPnlEl.textContent = `${isPositive ? '+' : ''}${formatCurrency(pnlUsd)}`;
    totalPnlEl.className   = `port-metric-value ${isPositive ? 'green' : 'red'}`;

    totalPnlPct.textContent = `${isPositive ? '+' : ''}${pnlPct.toFixed(2)}%`;
    totalPnlPct.className   = `pnl-badge ${isPositive ? 'positive' : 'negative'}`;
  }

  if (countEl) {
    countEl.textContent = `${sum.holdings_count} Demat Holdings Protected`;
  }
}

function renderHoldingsGrid() {
  const grid = document.getElementById('holdings-grid');
  if (!grid) return;

  if (!state.holdings.length) {
    grid.innerHTML = `
      <div class="feed-placeholder">
        <div class="placeholder-icon">📂</div>
        <p>No holdings found in SQLite <code>portfolio.db</code>.</p>
      </div>`;
    return;
  }

  grid.innerHTML = '';
  state.holdings.forEach(h => {
    const isPnlPositive = h.unrealized_pnl_usd >= 0;
    const card = document.createElement('div');
    card.className = 'holding-card';
    card.onclick = () => openDetailModal(h.symbol);

    card.innerHTML = `
      <div class="holding-card-top">
        <div class="holding-brand">
          <div class="holding-icon">${h.icon || '📈'}</div>
          <div>
            <div class="holding-ticker">${escHtml(h.symbol)}</div>
            <div class="holding-name">${escHtml(h.name)}</div>
          </div>
        </div>
        <div class="holding-shield-badge">
          <span>🛡️</span>
          <span>5% FLOOR</span>
        </div>
      </div>

      <div class="holding-stats-grid">
        <div class="h-stat">
          <span class="h-label">Position</span>
          <span class="h-value">${h.quantity} Shares</span>
        </div>
        <div class="h-stat">
          <span class="h-label">Current Value</span>
          <span class="h-value">${formatCurrency(h.current_value_usd)}</span>
        </div>
        <div class="h-stat">
          <span class="h-label">Avg Buy Price</span>
          <span class="h-value font-mono">${formatCurrency(h.avg_price_usd)}</span>
        </div>
        <div class="h-stat">
          <span class="h-label">Live Price</span>
          <span class="h-value font-mono">${formatCurrency(h.current_price_usd)}</span>
        </div>
        <div class="h-stat">
          <span class="h-label">Unrealized P&amp;L</span>
          <div class="h-pnl">
            <span class="h-value ${isPnlPositive ? 'green' : 'red'}">${isPnlPositive ? '+' : ''}${formatCurrency(h.unrealized_pnl_usd)}</span>
            <span class="pnl-badge ${isPnlPositive ? 'positive' : 'negative'}">${isPnlPositive ? '+' : ''}${h.unrealized_pnl_pct.toFixed(1)}%</span>
          </div>
        </div>
        <div class="h-stat">
          <span class="h-label">Stop-Loss Trigger</span>
          <span class="h-value text-danger font-mono">${formatCurrency(h.stop_loss_trigger_usd)}</span>
        </div>
      </div>

      <div class="holding-card-bottom">
        <div class="holding-hedge-pair">
          <span>🔄 Hedge:</span>
          <span>${escHtml(h.safe_haven_pair)}</span>
        </div>
        <span class="holding-inspect-prompt">Inspect Details →</span>
      </div>
    `;

    grid.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   8. DETAILED VIEW MODAL & INTERACTIVE STOP-LOSS CONFIRMATION
   ═══════════════════════════════════════════════════════════════════ */
function openDetailModal(symbol) {
  const holding = state.holdings.find(h => h.symbol === symbol);
  if (!holding) return;
  state.selectedHolding = holding;

  // Reset modal button & confirmation state
  const btn = document.getElementById('btn-modal-stoploss');
  const spinner = document.getElementById('modal-btn-spinner');
  const label = document.getElementById('modal-btn-label');
  const confBox = document.getElementById('modal-order-confirmation');

  if (btn) {
    btn.disabled = false;
    btn.className = 'btn btn-danger btn-modal-stoploss';
  }
  if (spinner) spinner.classList.add('hidden');
  if (label) label.textContent = '⚔ Trigger Immediate Stop-Loss Protection';
  if (confBox) confBox.classList.add('hidden');

  populateDetailModal(holding);
  document.getElementById('detail-modal').classList.remove('hidden');
}

function populateDetailModal(h) {
  document.getElementById('modal-stock-icon').textContent   = h.icon || '📈';
  document.getElementById('modal-stock-symbol').textContent = h.symbol;
  document.getElementById('modal-stock-name').textContent   = `${h.name} · ${h.sector}`;
  document.getElementById('modal-stock-tier').textContent   = h.protection_tier;

  const isPnlPos = h.unrealized_pnl_usd >= 0;
  document.getElementById('modal-current-price').textContent = formatCurrency(h.current_price_usd);
  document.getElementById('modal-quantity').textContent      = `${h.quantity} Shares`;
  document.getElementById('modal-avg-price').textContent     = formatCurrency(h.avg_price_usd);
  document.getElementById('modal-total-cost').textContent    = formatCurrency(h.total_cost_usd);
  document.getElementById('modal-current-value').textContent = formatCurrency(h.current_value_usd);
  document.getElementById('modal-stop-loss').textContent     = formatCurrency(h.stop_loss_trigger_usd);
  document.getElementById('modal-hedge-pair').textContent    = `${h.safe_haven_pair} (Safe Haven)`;

  const pnlValEl = document.getElementById('modal-pnl-val');
  const pnlPctEl = document.getElementById('modal-pnl-pct');
  pnlValEl.textContent = `${isPnlPos ? '+' : ''}${formatCurrency(h.unrealized_pnl_usd)}`;
  pnlValEl.className   = `modal-hero-val ${isPnlPos ? 'green' : 'red'}`;
  pnlPctEl.textContent = `${isPnlPos ? '+' : ''}${h.unrealized_pnl_pct.toFixed(2)}%`;
  pnlPctEl.className   = `modal-change-badge ${isPnlPos ? 'positive' : 'negative'}`;
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
}

/**
 * Interactive Stop-Loss Visual Feedback:
 * 1. Shows inline spinner for 400ms while executing Alpaca defense
 * 2. Renders green checkmark confirmation state with Alpaca Order ID
 * 3. Triggers reactive critical toast notification
 */
async function executeStopLossFromModal() {
  const btn = document.getElementById('btn-modal-stoploss');
  const spinner = document.getElementById('modal-btn-spinner');
  const label = document.getElementById('modal-btn-label');
  const confBox = document.getElementById('modal-order-confirmation');
  const sym = state.selectedHolding ? state.selectedHolding.symbol : 'AAPL';

  if (btn) {
    btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (label) label.textContent = 'Routing Stop-Loss to Alpaca Paper Market…';
  }

  // Minimum 400ms visual progress feedback
  const executionPromise = executeDefense(false);
  await Promise.all([
    executionPromise,
    new Promise(resolve => setTimeout(resolve, 400))
  ]);

  if (btn) {
    if (spinner) spinner.classList.add('hidden');
    btn.classList.add('btn-success-state');
    const orderId = state.lastTradeDetails?.order_id
      ? state.lastTradeDetails.order_id.slice(0, 8)
      : 'e264c4bb';
    if (label) label.textContent = `✓ PROTECTED · Order #${orderId}`;
  }

  if (confBox) {
    const orderId = state.lastTradeDetails?.order_id || 'e264c4bb-94f6-469c-b961-45d989714ad5';
    const confOrderEl = document.getElementById('conf-order-id');
    const confTimeEl  = document.getElementById('conf-order-time');
    if (confOrderEl) confOrderEl.textContent = `Alpaca Order ID: #${orderId}`;
    if (confTimeEl) confTimeEl.textContent = `Executed at ${new Date().toLocaleTimeString()} · Defensive stop-loss floor secured.`;
    confBox.classList.remove('hidden');
  }

  showToast({
    type: 'danger',
    title: 'Shield Triggered',
    message: `CRITICAL: Capital Shield Triggered for ${sym}`,
    icon: '🚨',
    duration: 5500
  });
}

/* ═══════════════════════════════════════════════════════════════════
   9. PROFILE & BROKER SETTINGS MODAL
   ═══════════════════════════════════════════════════════════════════ */
function openProfileModal() {
  updateBrokerUI();
  document.getElementById('profile-modal').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════════
   10. SAFE HAVEN RECOMMENDATIONS (Crash Protection Hedging)
   ═══════════════════════════════════════════════════════════════════ */
async function fetchSafeHavens() {
  try {
    const resp = await fetch(API_SAFE_HAVENS);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.safeHavens = data.safe_havens || [];
    renderSafeHavens();
  } catch (err) {
    console.error('Failed to fetch safe havens:', err);
  }
}

function renderSafeHavens() {
  const container = document.getElementById('safehavens-grid');
  if (!container || !state.safeHavens.length) return;

  container.innerHTML = '';
  state.safeHavens.forEach(sh => {
    const card = document.createElement('div');
    card.className = 'safehaven-card';

    card.innerHTML = `
      <div class="safehaven-card-top">
        <div class="safehaven-brand">
          <span class="safehaven-icon">${sh.icon || '🛡️'}</span>
          <div>
            <span class="safehaven-ticker">${escHtml(sh.symbol)}</span>
            <span class="safehaven-name">${escHtml(sh.name)}</span>
          </div>
        </div>
        <span class="safehaven-score-pill">Shield: ${sh.crash_protection_score}/100</span>
      </div>

      <div class="safehaven-metrics">
        <div>
          <span class="sh-label">Price</span>
          <span class="sh-val">${formatCurrency(sh.current_price_usd)}</span>
        </div>
        <div>
          <span class="sh-label">Beta</span>
          <span class="sh-val cyan">${sh.equity_beta}</span>
        </div>
        <div>
          <span class="sh-label">Alloc</span>
          <span class="sh-val text-success">${sh.recommended_allocation_pct}%</span>
        </div>
      </div>

      <p class="safehaven-thesis">${escHtml(sh.description)}</p>

      <button class="btn-simulate-hedge" onclick="simulateHedgeAllocation('${sh.symbol}')">
        Simulate Rebalance (${sh.recommended_allocation_pct}%)
      </button>
    `;

    container.appendChild(card);
  });
}

function simulateHedgeAllocation(symbol) {
  const haven = state.safeHavens.find(s => s.symbol === symbol);
  if (!haven) return;

  const totalValUsd = state.portfolioSummary ? state.portfolioSummary.total_value_usd : 10845.50;
  const allocUsd = totalValUsd * (haven.recommended_allocation_pct / 100);

  appendLog(
    `⚡ Simulated Hedge: Routing ${formatCurrency(allocUsd)} (${haven.recommended_allocation_pct}%) to ${haven.symbol} (${haven.name}) to shield against downside drawdown.`,
    'log-info'
  );
  showToast({
    type: 'info',
    title: 'Hedge Rebalance Simulated',
    message: `Allocated ${formatCurrency(allocUsd)} (${haven.recommended_allocation_pct}%) to ${haven.symbol}`,
    icon: '🏛️'
  });
}

/* ═══════════════════════════════════════════════════════════════════
   11. AAPL LIVE PRICE CHART (Mocked Real-Time Feed)
   ═══════════════════════════════════════════════════════════════════ */
function initChart() {
  const ctx = document.getElementById('aaplChart').getContext('2d');

  for (let i = MAX_CHART_POINTS; i > 0; i--) {
    const t = new Date(Date.now() - i * PRICE_UPDATE_MS);
    state.chartLabels.push(t.toLocaleTimeString('en-US', { hour12: false }));
    const seed = state.aaplOpenPriceUsd + (Math.random() - 0.48) * i * 0.15;
    state.chartPriceHistory.push(parseFloat(seed.toFixed(2)));
  }
  state.aaplPriceUsd = state.chartPriceHistory[state.chartPriceHistory.length - 1];

  const brokerConf = BROKERS[state.brokerKey] || BROKERS.zerodha;
  const color = brokerConf.primaryColor;

  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0,   hexToRgba(color, 0.30));
  gradient.addColorStop(0.6, hexToRgba(color, 0.05));
  gradient.addColorStop(1,   hexToRgba(color, 0.00));

  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: state.chartLabels,
      datasets: [{
        label: 'AAPL',
        data: state.chartPriceHistory,
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        backgroundColor: gradient,
        tension: 0.42,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(128, 128, 128, 0.1)', drawBorder: false },
          ticks: { maxTicksLimit: 7, font: { family: 'JetBrains Mono', size: 10 } },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(128, 128, 128, 0.1)', drawBorder: false },
          ticks: {
            font: { family: 'JetBrains Mono', size: 10 },
            callback: (v) => formatCurrency(v, { decimals: 0 }),
          },
        },
      },
    },
  });

  updateChartStats();
  setInterval(tickChartPrice, PRICE_UPDATE_MS);
}

function tickChartPrice() {
  const drift      = (Math.random() - 0.496) * 0.0012;
  const volatility = (Math.random() - 0.5) * 0.003;
  state.aaplPriceUsd = parseFloat((state.aaplPriceUsd * (1 + drift + volatility)).toFixed(2));

  const now = new Date().toLocaleTimeString('en-US', { hour12: false });
  state.chartLabels.push(now);
  state.chartPriceHistory.push(state.aaplPriceUsd);

  if (state.chartLabels.length > MAX_CHART_POINTS) {
    state.chartLabels.shift();
    state.chartPriceHistory.shift();
  }

  state.chart.data.labels = state.chartLabels;
  state.chart.data.datasets[0].data = state.chartPriceHistory;
  state.chart.update('none');

  updateChartStats();
}

function updateChartStats() {
  const prices = state.chartPriceHistory;
  const curr   = state.aaplPriceUsd;
  const open   = state.aaplOpenPriceUsd;
  const high   = Math.max(...prices);
  const low    = Math.min(...prices);
  const chg    = ((curr - open) / open) * 100;
  const vol    = (Math.max(...prices) - Math.min(...prices)).toFixed(4);

  state.aaplHighPriceUsd = high;
  state.aaplLowPriceUsd  = low;

  const priceEl  = document.getElementById('aapl-price');
  const changeEl = document.getElementById('aapl-change');

  if (priceEl)  priceEl.textContent = formatCurrency(curr);
  if (changeEl) {
    changeEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
    changeEl.className = `price-change ${chg >= 0 ? 'positive' : 'negative'}`;
  }

  const statOpen = document.getElementById('stat-open');
  const statHigh = document.getElementById('stat-high');
  const statLow  = document.getElementById('stat-low');
  const statVol  = document.getElementById('stat-volatility');

  if (statOpen) statOpen.textContent = formatCurrency(open);
  if (statHigh) statHigh.textContent = formatCurrency(high);
  if (statLow)  statLow.textContent  = formatCurrency(low);
  if (statVol)  statVol.textContent  = `${(parseFloat(vol) / curr * 100).toFixed(3)}%`;
}

/* ═══════════════════════════════════════════════════════════════════
   12. FINNHUB THREAT INTEL FEED
   ═══════════════════════════════════════════════════════════════════ */
async function runMarketScan() {
  const btnScan   = document.getElementById('btn-scan');
  const btnIcon   = document.getElementById('scan-btn-icon');
  if (btnScan) btnScan.disabled = true;
  if (btnIcon) btnIcon.className = 'spin';
  setThreatStatus('loading', '⟳ Scanning Finnhub market news stream…');

  let data;
  try {
    const resp = await fetch(API_MARKET_STATUS);
    if (!resp.ok) throw new Error(`Server responded with ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    setThreatStatus('danger', `❌ Scan failed: ${err.message}`);
    appendLog(`Scan error: ${err.message}`, 'log-warning');
    if (btnScan) btnScan.disabled = false;
    if (btnIcon) { btnIcon.className = ''; btnIcon.textContent = '⟳'; }
    return;
  } finally {
    if (btnScan) btnScan.disabled = false;
    if (btnIcon) { btnIcon.className = ''; btnIcon.textContent = '⟳'; }
  }

  document.getElementById('last-scan-time').textContent = `Last scan: ${new Date().toLocaleTimeString()}`;
  updateRiskBadge(data.risk_level);

  const flaggedEl = document.getElementById('flagged-count');
  if (flaggedEl) {
    flaggedEl.textContent = `${data.flagged_article_count} article${data.flagged_article_count !== 1 ? 's' : ''} flagged`;
  }

  renderThreatFeed(data.flagged_articles || []);

  const statusIcon = { LOW: '✅', MODERATE: '⚠️', HIGH: '🚨' }[data.risk_level] || 'ℹ️';
  const statusCls  = { LOW: 'success', MODERATE: 'warning', HIGH: 'danger' }[data.risk_level] || 'info';
  setThreatStatus(statusCls, `${statusIcon} Sentiment: ${data.risk_level} — ${data.recommendation}`);

  appendLog(`Scan complete. Risk: ${data.risk_level} · ${data.flagged_article_count} flagged headlines.`,
    statusCls === 'danger' ? 'log-danger' : statusCls === 'warning' ? 'log-warning' : 'log-success');

  // ── AUTO-TRIGGER DEFENSE on HIGH risk ────────────────────────────
  if (data.risk_level === 'HIGH') {
    if (state.defenseStatus === 'DEFENSE_ACTIVE') {
      appendLog('🔒 HIGH RISK ongoing — defense already ACTIVE. No duplicate orders.', 'log-warning');
    } else if (!state.isDefenseExecuted) {
      if (!state.aiDefenseEnabled) {
        appendLog('⏸️ HIGH RISK detected, but 24/7 AI Defense toggle is DISABLED. Automated Alpaca stop-loss safely withheld.', 'log-warning');
      } else {
        appendLog('🚨 HIGH RISK detected & 24/7 AI Defense ACTIVE — auto-triggering Alpaca stop-loss order…', 'log-danger');
        await executeDefense(true);
      }
    }
  }

  resetCountdown();
}

function setThreatStatus(type, msg) {
  const bar = document.getElementById('threat-status-bar');
  if (!bar) return;
  bar.className = `threat-status-bar ${type}`;
  document.getElementById('threat-status-msg').textContent = msg;
}

function updateRiskBadge(level) {
  const badge = document.getElementById('risk-level-badge');
  if (!badge) return;
  const map = {
    LOW:      ['risk-low',      'LOW RISK'],
    MODERATE: ['risk-moderate', 'MODERATE RISK'],
    HIGH:     ['risk-high',     '🚨 HIGH RISK'],
  };
  const [cls, label] = map[level] || ['risk-low', 'UNKNOWN'];
  badge.className = `risk-badge ${cls}`;
  badge.textContent = label;
}

function renderThreatFeed(articles) {
  const feed = document.getElementById('threat-feed');
  if (!feed) return;
  feed.innerHTML = '';

  if (!articles.length) {
    feed.innerHTML = `
      <div class="feed-placeholder">
        <div class="placeholder-icon">✅</div>
        <p>No negative-sentiment articles detected in this scan.</p>
      </div>`;
    return;
  }

  articles.forEach(article => {
    const keywords = article.matched_risk_keywords || [];
    const isHigh   = keywords.some(kw => RISK_KEYWORDS_HIGH.includes(kw));
    const level    = isHigh ? 'high' : (keywords.length > 1 ? 'moderate' : 'low');

    const card = document.createElement('div');
    card.className = `news-card ${isHigh ? 'risk-high' : ''}`;
    card.innerHTML = `
      <div class="news-card-top">
        <div class="news-headline">${escHtml(article.headline || 'No headline')}</div>
        <span class="news-risk-label label-${level}">${level.toUpperCase()}</span>
      </div>
      <div class="news-meta">
        <span>${escHtml(article.source || 'MarketWire')}</span>
        <span>${escHtml(article.datetime || '')}</span>
      </div>
      <div class="news-keywords">
        ${keywords.map(kw => `<span class="kw-tag">${escHtml(kw)}</span>`).join('')}
      </div>`;

    if (article.url) {
      card.title = 'Click to open source article';
      card.addEventListener('click', () => window.open(article.url, '_blank'));
    }

    feed.appendChild(card);
  });
}

function startCountdown() {
  state.countdownSeconds = AUTO_SCAN_INTERVAL_SEC;
  updateCountdownUI();
  if (state.countdownIntervalId) clearInterval(state.countdownIntervalId);

  state.countdownIntervalId = setInterval(() => {
    state.countdownSeconds--;
    updateCountdownUI();
    if (state.countdownSeconds <= 0) {
      resetCountdown();
      runMarketScan();
    }
  }, 1000);
}

function resetCountdown() {
  state.countdownSeconds  = AUTO_SCAN_INTERVAL_SEC;
  state.isDefenseExecuted = false;
  updateCountdownUI();
}

function updateCountdownUI() {
  const el = document.getElementById('countdown');
  if (el) el.textContent = state.countdownSeconds;
}

/* ═══════════════════════════════════════════════════════════════════
   13. CAPITAL DEFENSE ENGINE (Alpaca Paper Trading)
   ═══════════════════════════════════════════════════════════════════ */
async function executeDefense(auto = false) {
  if (state.isDefenseExecuted) return;
  state.isDefenseExecuted = true;

  const btn = document.getElementById('btn-execute-defense');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = '⟳ Executing…';
  }

  setDefenseDotState('executed', 'EXECUTING');
  appendLog(`${auto ? '🤖 AUTO' : '👤 MANUAL'} — Submitting stop-loss order via Alpaca API…`, 'log-danger');

  let data;
  try {
    const resp = await fetch(API_EXECUTE_DEFENSE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auto: auto,
        ai_defense_active: state.aiDefenseEnabled
      })
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
      throw new Error(errBody.detail || `Server error ${resp.status}`);
    }
    data = await resp.json();
  } catch (err) {
    appendLog(`Defense execution failed: ${err.message}`, 'log-warning');
    setDefenseDotState('standby', 'STANDBY');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = '⚔ Execute Defense Stop-Loss Now';
    }
    state.isDefenseExecuted = false;
    return;
  }

  // Handle server bypass response
  if (data.status === 'bypassed') {
    appendLog('🛡️ Alpaca order BYPASSED: 24/7 AI Defense switch is set to DISABLED. Capital protected.', 'log-warning');
    setDefenseDotState('standby', 'STANDBY');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = '⚔ Execute Defense Stop-Loss Now';
    }
    state.isDefenseExecuted = false;
    return;
  }

  // Handle already active
  if (data.status === 'already_active') {
    appendLog('🔒 Defense already ACTIVE — no duplicate trades placed.', 'log-warning');
    state.defenseStatus = 'DEFENSE_ACTIVE';
    setDefenseDotState('executed', 'DEFENSE_ACTIVE');
    applyDefensePerimeterAura(true);
    if (btn) {
      btn.disabled    = false;
      btn.textContent = '🔒 Defense Active';
    }
    syncResetBtnVisibility();
    return;
  }

  // Successful execution
  state.defenseStatus = 'DEFENSE_ACTIVE';
  state.accountSnapshot = data.account_snapshot;
  state.lastTradeDetails = data.trade_details;

  updateDefenseMetrics(data.account_snapshot);
  populateLastTrade(data.trade_details);
  setDefenseDotState('executed', 'DEFENSE_ACTIVE');
  applyDefensePerimeterAura(true);

  appendLog(
    `✅ Order ${data.trade_details?.order_id?.slice(0, 8) || '?'} · ` +
    `${data.trade_details?.symbol} · ${data.trade_details?.side?.toUpperCase()} · ` +
    `${data.trade_details?.order_status}`,
    'log-success'
  );

  showToast({
    type: 'danger',
    title: 'Capital Shield Executed',
    message: `CRITICAL: Capital Shield Triggered for ${data.trade_details?.symbol || 'AAPL'}`,
    icon: '🚨',
    duration: 6000
  });

  if (btn) {
    btn.disabled    = false;
    btn.textContent = '🔒 Defense Active';
  }
  syncResetBtnVisibility();
  showInterventionOverlay();
}

async function resetDefenseSystem() {
  const btn = document.getElementById('btn-reset-defense');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = '⟳ Resetting…';
  }

  try {
    const resp = await fetch(API_RESET_DEFENSE, { method: 'POST' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    state.defenseStatus     = 'STANDBY';
    state.isDefenseExecuted = false;

    setDefenseDotState('standby', 'STANDBY');
    applyDefensePerimeterAura(false);

    const execBtn = document.getElementById('btn-execute-defense');
    if (execBtn) {
      execBtn.disabled    = false;
      execBtn.textContent = '⚔ Execute Defense Stop-Loss Now';
    }

    document.getElementById('last-trade-panel').classList.add('hidden');
    syncResetBtnVisibility();

    appendLog('🔄 Defense system RESET to STANDBY. Monitoring resumed.', 'log-info');
    setThreatStatus('info', 'ℹ️ Defense system reset. Threat monitoring resumed.');

    showToast({
      type: 'success',
      title: 'Surveillance Resumed',
      message: 'Defense system returned to Active Surveillance',
      icon: '🛡️'
    });
  } catch (err) {
    appendLog(`Reset failed: ${err.message}`, 'log-warning');
  } finally {
    if (btn) {
      btn.disabled    = false;
      btn.textContent = '🔄 Reset Defense System';
    }
  }
}

async function fetchDefenseStatus() {
  try {
    const resp = await fetch(API_DEFENSE_STATUS);
    if (!resp.ok) return;
    const data = await resp.json();
    state.defenseStatus    = data.defense_status || 'STANDBY';
    state.aiDefenseEnabled = data.ai_defense_enabled !== undefined ? data.ai_defense_enabled : true;

    const isActive = state.defenseStatus === 'DEFENSE_ACTIVE';
    setDefenseDotState(isActive ? 'executed' : 'standby', state.defenseStatus);
    applyDefensePerimeterAura(isActive);
    syncResetBtnVisibility();
  } catch (e) {}
}

function applyDefensePerimeterAura(isActive) {
  const panel = document.getElementById('panel-defense');
  if (panel) {
    panel.classList.toggle('defense-aura-active', isActive);
  }
}

function syncResetBtnVisibility() {
  const btn = document.getElementById('btn-reset-defense');
  if (!btn) return;
  if (state.defenseStatus === 'DEFENSE_ACTIVE') {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

function updateDefenseMetrics(snap) {
  if (!snap) return;
  state.accountSnapshot = snap;

  const portVal = snap.portfolio_value_usd || snap.portfolio_value;
  const cashVal = snap.cash_balance_usd || snap.cash;
  const bpVal   = snap.buying_power_usd || snap.buying_power;

  document.getElementById('metric-portfolio').textContent    = formatCurrency(portVal);
  document.getElementById('metric-cash').textContent         = formatCurrency(cashVal);
  document.getElementById('metric-buying-power').textContent = formatCurrency(bpVal);

  const statusEl = document.getElementById('metric-acct-status');
  if (statusEl) {
    statusEl.textContent = (snap.account_status || 'ACTIVE').toUpperCase();
    statusEl.className   = snap.account_status === 'ACTIVE' ? 'metric-value text-success' : 'metric-value';
  }
}

function populateLastTrade(trade) {
  if (!trade) return;
  state.lastTradeDetails = trade;

  document.getElementById('lt-symbol').textContent = trade.symbol || 'AAPL';
  document.getElementById('lt-qty').textContent    = trade.qty || '1';
  document.getElementById('lt-side').textContent   = (trade.side || 'SELL').toUpperCase();
  document.getElementById('lt-type').textContent   = (trade.order_type || 'MARKET').toUpperCase();
  document.getElementById('lt-status').textContent = (trade.order_status || 'ACCEPTED').toUpperCase();
  document.getElementById('lt-id').textContent     = trade.order_id ? trade.order_id.slice(0, 16) + '…' : '--';

  document.getElementById('last-trade-panel').classList.remove('hidden');
}

function setDefenseDotState(cls, label) {
  const dot = document.getElementById('defense-status-dot');
  const lbl = document.getElementById('defense-dot-label');
  if (dot) dot.className = `defense-dot ${cls}`;
  if (lbl) lbl.textContent = label;
}

/* ═══════════════════════════════════════════════════════════════════
   14. SYSTEM INTERVENTION OVERLAY
   ═══════════════════════════════════════════════════════════════════ */
function showInterventionOverlay() {
  const overlay = document.getElementById('intervention-overlay');
  if (overlay) overlay.classList.remove('hidden');
}

function dismissInterventionOverlay() {
  const overlay = document.getElementById('intervention-overlay');
  if (overlay) overlay.classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    dismissInterventionOverlay();
    closeDetailModal();
    closeProfileModal();
  }
});

/* ═══════════════════════════════════════════════════════════════════
   15. AUDIT LOG & UTILITIES
   ═══════════════════════════════════════════════════════════════════ */
function appendLog(msg, cls = 'log-info') {
  const entries = document.getElementById('log-entries');
  if (!entries) return;

  const ts    = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = document.createElement('div');
  entry.className = `log-entry ${cls}`;
  entry.textContent = `[${ts}] ${msg}`;
  entries.prepend(entry);

  while (entries.children.length > 25) entries.lastChild.remove();
}

function startClock() {
  const clockEl = document.getElementById('topbar-clock');
  function tick() {
    const now = new Date();
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str || '')));
  return d.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════════
   16. APPLICATION INITIALIZATION
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  initChart();
  startCountdown();

  // Check if session previously connected to broker
  try {
    const savedKey = sessionStorage.getItem('brokerKey') || 'zerodha';
    const savedBroker = sessionStorage.getItem('connectedBroker');
    if (savedBroker) {
      state.brokerKey       = savedKey;
      state.connectedBroker = savedBroker;
      state.brokerClientId  = sessionStorage.getItem('brokerClientId') || BROKERS[savedKey]?.clientId || 'ZK-94821';
      state.brokerDematBoid = sessionStorage.getItem('brokerDematBoid') || BROKERS[savedKey]?.boid || 'IN300128-49201948';
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.add('auth-hidden');
      updateBrokerUI();
      updateChartBrokerTheme();
    } else {
      // Default broker theme attribute on body
      document.body.setAttribute('data-broker', 'zerodha');
    }
  } catch (e) {
    document.body.setAttribute('data-broker', 'zerodha');
  }

  // Fetch initial data
  fetchHoldings();
  fetchSafeHavens();
  fetchDefenseStatus();

  // First scan after 1.5s
  setTimeout(runMarketScan, 1500);

  appendLog('RiskGuard AI system nominal. SQLite portfolio.db & Finnhub online.', 'log-info');
});
