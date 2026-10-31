// Brightloop Subscription Management System - Client Application

let currentUser = null;
let currentToken = null;
let currentTab = 'dashboard';
let cachedProducts = [];
let cachedPlans = [];
let cachedCustomers = [];
let cachedTemplates = [];
let cachedTaxes = [];
let cachedDiscounts = [];

// Initialize application on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Default login as Admin for instant interactive exploration
  await loginAs('admin@brightloop.com', 'Brightloop@2026', false);
  
  // Set default billing date to today
  const todayStr = new Date().toISOString().split('T')[0];
  const billingInput = document.getElementById('billingTargetDate');
  if (billingInput) billingInput.value = todayStr;

  const newSubStart = document.getElementById('newSubStartDate');
  if (newSubStart) newSubStart.value = todayStr;

  lucide.createIcons();
});

// Toast notification helper
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  const iconEl = document.getElementById('toastIcon');

  msgEl.innerText = message;
  if (type === 'success') {
    iconEl.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5 text-emerald-400"></i>';
    toast.className = toast.className.replace(/border-[a-z0-9\/-]+/g, '') + ' border-emerald-500/50';
  } else if (type === 'error') {
    iconEl.innerHTML = '<i data-lucide="alert-circle" class="w-5 h-5 text-rose-400"></i>';
    toast.className = toast.className.replace(/border-[a-z0-9\/-]+/g, '') + ' border-rose-500/50';
  } else {
    iconEl.innerHTML = '<i data-lucide="info" class="w-5 h-5 text-blue-400"></i>';
    toast.className = toast.className.replace(/border-[a-z0-9\/-]+/g, '') + ' border-blue-500/50';
  }
  lucide.createIcons();

  toast.classList.remove('translate-y-24');
  setTimeout(() => {
    toast.classList.add('translate-y-24');
  }, 3500);
}

// Authentication & Persona Switching
async function loginAs(email, password, showMessage = true) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    currentToken = data.token;
    currentUser = data.user;
    updateAuthUI();

    if (showMessage) {
      showToast(`Logged in as ${currentUser.name} (${currentUser.role.toUpperCase()})`);
    }

    // Load initial reference data
    await loadReferenceData();
    switchTab(currentUser.role === 'customer' ? 'portal' : currentTab);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateAuthUI() {
  const nameEl = document.getElementById('userNameDisplay');
  const roleEl = document.getElementById('userRoleDisplay');
  const avatarEl = document.getElementById('userAvatar');
  const authLabel = document.getElementById('authButtonLabel');

  if (currentUser) {
    nameEl.innerText = currentUser.name;
    roleEl.innerText = currentUser.role.toUpperCase();
    avatarEl.innerText = currentUser.name.charAt(0).toUpperCase();
    authLabel.innerText = 'Switch';

    // Hide or show admin-only navigation links
    document.querySelectorAll('.admin-only-nav').forEach(el => {
      el.style.display = currentUser.role === 'admin' ? 'flex' : 'none';
    });
    document.querySelectorAll('.admin-only-btn').forEach(el => {
      el.style.display = currentUser.role === 'admin' ? 'inline-flex' : 'none';
    });
  } else {
    nameEl.innerText = 'Guest User';
    roleEl.innerText = 'LOGGED OUT';
    avatarEl.innerText = '?';
    authLabel.innerText = 'Sign In';
  }
  lucide.createIcons();
}

function handleLogout() {
  currentToken = null;
  currentUser = null;
  updateAuthUI();
  openModal('modalAuth');
  showToast('Logged out successfully', 'info');
}

// Load static reference datasets
async function loadReferenceData() {
  try {
    const headers = currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {};
    const [pRes, plRes, cRes, tRes, txRes, dRes] = await Promise.all([
      fetch('/api/products', { headers }),
      fetch('/api/plans', { headers }),
      fetch('/api/customers', { headers }),
      fetch('/api/quotation-templates', { headers }),
      fetch('/api/taxes', { headers }),
      fetch('/api/discounts', { headers })
    ]);

    cachedProducts = await pRes.json();
    cachedPlans = await plRes.json();
    cachedCustomers = await cRes.json();
    cachedTemplates = await tRes.json();
    cachedTaxes = await txRes.json();
    cachedDiscounts = await dRes.json();

    populateFilterDropdowns();
  } catch (err) {
    console.error('Failed to load reference data:', err);
  }
}

function populateFilterDropdowns() {
  // Plan filter
  const planSelect = document.getElementById('subPlanFilter');
  if (planSelect) {
    planSelect.innerHTML = '<option value="">All Plans</option>' +
      cachedPlans.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  // Customer dropdown for new sub
  const custSelect = document.getElementById('newSubCustomerSelect');
  if (custSelect) {
    custSelect.innerHTML = '<option value="">Select a customer...</option>' +
      cachedCustomers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.company_name || 'Individual')})</option>`).join('');
  }

  // Plan dropdown for new sub
  const newPlanSelect = document.getElementById('newSubPlanSelect');
  if (newPlanSelect) {
    newPlanSelect.innerHTML = '<option value="">Select a subscription plan...</option>' +
      cachedPlans.map(p => `<option value="${p.id}">${escapeHtml(p.name)} - $${p.base_cost}/${p.billing_frequency}</option>`).join('');
  }

  // Template dropdown for new sub
  const tmplSelect = document.getElementById('newSubTemplateSelect');
  if (tmplSelect) {
    tmplSelect.innerHTML = '<option value="">-- Choose a template to pre-populate --</option>' +
      cachedTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.plan_name)})</option>`).join('');
  }
}

// Tab Switching
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active-nav'));

  const activePanel = document.getElementById(`view-${tabName}`);
  const activeNav = document.getElementById(`nav-${tabName}`);

  if (activePanel) activePanel.classList.remove('hidden');
  if (activeNav) activeNav.classList.add('active-nav');

  // Trigger data reload for active tab
  if (tabName === 'dashboard') loadDashboard();
  else if (tabName === 'subscriptions') loadSubscriptions();
  else if (tabName === 'billing') loadBillingCenter();
  else if (tabName === 'invoices') loadInvoices();
  else if (tabName === 'payments') loadPayments();
  else if (tabName === 'products') loadProducts();
  else if (tabName === 'plans') loadPlans();
  else if (tabName === 'templates') loadTemplates();
  else if (tabName === 'discounts-taxes') loadDiscountsAndTaxes();
  else if (tabName === 'staff') loadStaff();
  else if (tabName === 'portal') loadCustomerPortal();
  else if (tabName === 'audit') loadAuditLogs();

  lucide.createIcons();
}

// ----------------------------------------------------
// TAB 1: EXECUTIVE FINANCE LEAD DASHBOARD
// ----------------------------------------------------
async function loadDashboard() {
  const startTime = performance.now();
  try {
    const res = await fetch('/api/analytics/summary');
    const data = await res.json();
    const durationMs = (performance.now() - startTime).toFixed(1);

    document.getElementById('dashQueryTime').innerText = `Query: ${durationMs}ms (DB: ${data.meta.execution_time_ms}ms)`;

    // KPIs
    document.getElementById('kpiMrr').innerText = formatCurrency(data.metrics.mrr);
    document.getElementById('kpiArr').innerText = formatCurrency(data.metrics.arr);
    document.getElementById('kpiCollected').innerText = formatCurrency(data.metrics.total_revenue_collected);
    document.getElementById('kpiOverdue').innerText = formatCurrency(data.metrics.total_overdue_amount);
    document.getElementById('kpiOverdueCount').innerText = `${data.metrics.overdue_count} invoices`;

    // Counts
    document.getElementById('dashActiveCount').innerText = data.metrics.active_subscriptions;
    document.getElementById('dashPausedCount').innerText = data.metrics.paused_subscriptions;
    document.getElementById('dashQuotesCount').innerText = data.metrics.quotations_pending + data.metrics.confirmed_subscriptions;
    document.getElementById('dashClosedCount').innerText = data.metrics.closed_subscriptions;

    // Badges in sidebar
    document.getElementById('activeSubsCountBadge').innerText = data.metrics.active_subscriptions;
    document.getElementById('overdueCountBadge').innerText = data.metrics.overdue_count;

    // Aging Buckets Container
    const agingContainer = document.getElementById('agingBucketsContainer');
    agingContainer.innerHTML = Object.entries(data.aging_buckets).map(([bucket, info]) => `
      <div class="bg-slate-900 border border-slate-800 p-3 rounded-xl">
        <span class="text-[10px] uppercase font-bold text-slate-400 block">${bucket}</span>
        <div class="text-base font-bold font-mono ${info.amount > 0 ? 'text-rose-400' : 'text-slate-300'} mt-1">
          ${formatCurrency(info.amount)}
        </div>
        <div class="text-[10px] text-slate-500 mt-0.5">${info.count} invoice${info.count === 1 ? '' : 's'}</div>
      </div>
    `).join('');

    // Overdue Invoices Table
    const overdueTable = document.getElementById('overdueTableBody');
    document.getElementById('overdueCountPill').innerText = `${data.overdue_invoices.length} Overdue`;

    if (data.overdue_invoices.length === 0) {
      overdueTable.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">🎉 No overdue invoices! All payments are currently up to date.</td></tr>`;
    } else {
      // Find full invoice details for each overdue item
      const invRes = await fetch('/api/invoices?overdue_only=true');
      const invList = await invRes.json();

      overdueTable.innerHTML = data.overdue_invoices.map(item => {
        const fullInv = invList.find(i => i.id === item.id) || {};
        return `
          <tr class="hover:bg-slate-900/60 transition">
            <td class="py-3 px-4 font-mono font-bold text-blue-400 cursor-pointer" onclick="viewInvoice('${item.id}')">
              ${item.invoice_number}
            </td>
            <td class="py-3 px-4 font-medium text-slate-200">
              ${escapeHtml(fullInv.customer_name || 'Customer')}
            </td>
            <td class="py-3 px-4 font-mono text-slate-400">${item.due_date}</td>
            <td class="py-3 px-4">
              <span class="bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded text-[10px] font-mono font-bold border border-rose-500/30">
                +${item.days_overdue} days (${item.aging_bucket})
              </span>
            </td>
            <td class="py-3 px-4 font-mono font-bold text-rose-400">
              ${formatCurrency(item.balance_due)}
            </td>
            <td class="py-3 px-4 text-right">
              <button onclick="chaseOverdue('${item.id}', '${item.invoice_number}')" class="bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 font-medium px-2.5 py-1 rounded transition flex items-center gap-1 ml-auto text-xs">
                <i data-lucide="bell-ring" class="w-3.5 h-3.5"></i> Chase Reminder
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
  lucide.createIcons();
}

async function chaseOverdue(invoiceId, invNum) {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/chase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to chase reminder');

    showToast(`Payment reminder sent for ${invNum}! Logged in audit trail.`);
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 2: SUBSCRIPTIONS & QUOTES
// ----------------------------------------------------
async function loadSubscriptions() {
  try {
    const search = document.getElementById('subSearchInput').value;
    const status = document.getElementById('subStatusFilter').value;
    const planId = document.getElementById('subPlanFilter').value;

    let query = `/api/subscriptions?`;
    if (search) query += `&search=${encodeURIComponent(search)}`;
    if (status) query += `&status=${encodeURIComponent(status)}`;
    if (planId) query += `&plan_id=${encodeURIComponent(planId)}`;

    const res = await fetch(query, {
      headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}
    });
    const subs = await res.json();

    const tbody = document.getElementById('subscriptionsTableBody');
    if (!subs || subs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500">No subscriptions matching filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = subs.map(s => {
      const badgeClass = getStatusBadgeClass(s.status);
      return `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="py-3 px-4 font-mono font-bold text-indigo-400">
            ${s.subscription_number}
          </td>
          <td class="py-3 px-4">
            <div class="font-semibold text-slate-200">${escapeHtml(s.customer_name)}</div>
            <div class="text-[11px] text-slate-400">${escapeHtml(s.company_name || '')}</div>
          </td>
          <td class="py-3 px-4">
            <div class="font-medium text-slate-300">${escapeHtml(s.plan_name)}</div>
            <div class="text-[11px] text-slate-500 uppercase font-mono">${s.billing_frequency}</div>
          </td>
          <td class="py-3 px-4 font-mono font-bold text-white">
            ${formatCurrency(s.recurring_total)}
          </td>
          <td class="py-3 px-4 font-mono text-slate-300">
            ${s.next_billing_date || '&mdash;'}
          </td>
          <td class="py-3 px-4">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
              ${s.status}
            </span>
          </td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              ${renderSubscriptionActions(s)}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load subscriptions:', err);
  }
  lucide.createIcons();
}

function renderSubscriptionActions(sub) {
  let actions = '';

  if (sub.status === 'Draft') {
    actions += `<button onclick="changeSubStatus('${sub.id}', 'Quotation')" class="px-2 py-1 rounded bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 text-[10px] font-semibold">Send Quote</button>`;
    actions += `<button onclick="changeSubStatus('${sub.id}', 'Confirmed')" class="px-2 py-1 rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/40 text-[10px] font-semibold">Confirm</button>`;
  } else if (sub.status === 'Quotation') {
    actions += `<button onclick="changeSubStatus('${sub.id}', 'Confirmed')" class="px-2 py-1 rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/40 text-[10px] font-semibold">Accept & Confirm</button>`;
  } else if (sub.status === 'Confirmed') {
    actions += `<button onclick="changeSubStatus('${sub.id}', 'Active')" class="px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/40 text-[10px] font-semibold">Activate</button>`;
  } else if (sub.status === 'Active') {
    if (sub.allow_pause) {
      actions += `<button onclick="changeSubStatus('${sub.id}', 'Paused')" class="px-2 py-1 rounded bg-amber-600/20 text-amber-400 border border-amber-500/30 hover:bg-amber-600/40 text-[10px] font-semibold">Pause</button>`;
    }
    if (sub.allow_early_close) {
      actions += `<button onclick="changeSubStatus('${sub.id}', 'Closed')" class="px-2 py-1 rounded bg-rose-600/20 text-rose-400 border border-rose-500/30 hover:bg-rose-600/40 text-[10px] font-semibold">Close</button>`;
    }
  } else if (sub.status === 'Paused') {
    actions += `<button onclick="changeSubStatus('${sub.id}', 'Active')" class="px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/40 text-[10px] font-semibold">Resume</button>`;
  } else if (sub.status === 'Closed' && sub.allow_renewal) {
    actions += `<button onclick="changeSubStatus('${sub.id}', 'Active')" class="px-2 py-1 rounded bg-purple-600/20 text-purple-400 border border-purple-500/30 hover:bg-purple-600/40 text-[10px] font-semibold">Renew</button>`;
  }

  return actions;
}

async function changeSubStatus(subId, newStatus) {
  try {
    const res = await fetch(`/api/subscriptions/${subId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update subscription status');

    showToast(`Subscription status updated to ${newStatus}`);
    loadSubscriptions();
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 3: BILLING DAY ENGINE
// ----------------------------------------------------
async function loadBillingCenter() {
  const targetDate = document.getElementById('billingTargetDate').value || new Date().toISOString().split('T')[0];
  try {
    const res = await fetch(`/api/subscriptions?status=Active`);
    const subs = await res.json();

    const dueSubs = subs.filter(s => s.next_billing_date <= targetDate);
    document.getElementById('dueSubsCountBadge').innerText = `${dueSubs.length} Due`;

    const tbody = document.getElementById('dueSubscriptionsTableBody');
    if (dueSubs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500">No active subscriptions currently due on or before ${targetDate}.</td></tr>`;
      return;
    }

    tbody.innerHTML = dueSubs.map(s => `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="py-3 px-4 font-mono font-bold text-blue-400">${s.subscription_number}</td>
        <td class="py-3 px-4 font-medium text-slate-200">${escapeHtml(s.customer_name)}</td>
        <td class="py-3 px-4 text-slate-300">${escapeHtml(s.plan_name)}</td>
        <td class="py-3 px-4 font-mono text-slate-400 uppercase">${s.billing_frequency}</td>
        <td class="py-3 px-4 font-mono font-bold text-emerald-400">${formatCurrency(s.recurring_total)}</td>
        <td class="py-3 px-4 font-mono text-amber-400">${s.next_billing_date}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="billSingleSubscription('${s.id}')" class="bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded text-xs transition">
            Generate Invoice
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load billing center:', err);
  }
}

async function executeBillingDay() {
  const btn = document.getElementById('btnRunBilling');
  const targetDate = document.getElementById('billingTargetDate').value || new Date().toISOString().split('T')[0];

  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Running Billing Day...`;
  lucide.createIcons();

  try {
    const res = await fetch('/api/billing/run-day', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ targetDate })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Billing run failed');

    // Display execution card
    const card = document.getElementById('billingResultsCard');
    const badge = document.getElementById('billingSummaryBadge');
    const logs = document.getElementById('billingBatchOutput');

    card.classList.remove('hidden');
    badge.innerText = `${result.invoicesGenerated.length} Invoices Generated | Total: ${formatCurrency(result.totalBilledAmount)}`;

    logs.innerHTML = `
      <div class="text-slate-300">
        &bull; Billing Batch Completed for date: <span class="font-mono text-emerald-400 font-bold">${result.billingDate}</span>
      </div>
      <div class="text-slate-300">
        &bull; Subscriptions Evaluated: <span class="font-mono font-bold">${result.totalSubscriptionsDue}</span>
      </div>
      <div class="text-slate-300">
        &bull; Total Invoiced Volume: <span class="font-mono text-emerald-400 font-bold">${formatCurrency(result.totalBilledAmount)}</span>
      </div>
      <div class="pt-2 space-y-1">
        ${result.invoicesGenerated.map(inv => `
          <div class="p-2 bg-slate-900 rounded border border-slate-800 flex justify-between items-center">
            <span>
              <span class="font-mono font-bold text-blue-400 cursor-pointer" onclick="viewInvoice('${inv.invoiceId}')">${inv.invoiceNumber}</span>
              &rarr; ${escapeHtml(inv.customerName)} (${inv.subscriptionNumber})
            </span>
            <span class="font-mono font-bold text-emerald-400">${formatCurrency(inv.totalAmount)}</span>
          </div>
        `).join('')}
      </div>
    `;

    showToast(`Billing Day Complete: ${result.invoicesGenerated.length} invoices generated!`);
    loadBillingCenter();
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="play" class="w-4 h-4 fill-white"></i> Run Billing Day Now`;
    lucide.createIcons();
  }
}

async function billSingleSubscription(subId) {
  try {
    const targetDate = document.getElementById('billingTargetDate').value;
    const res = await fetch('/api/billing/generate-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ subscription_id: subId, billingDate: targetDate })
    });
    const inv = await res.json();
    if (!res.ok) throw new Error(inv.error || 'Failed to generate invoice');

    showToast(`Generated invoice ${inv.invoice_number}`);
    loadBillingCenter();
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 4: INVOICES
// ----------------------------------------------------
async function loadInvoices() {
  try {
    const search = document.getElementById('invSearchInput').value;
    const status = document.getElementById('invStatusFilter').value;

    let query = `/api/invoices?`;
    if (search) query += `&search=${encodeURIComponent(search)}`;
    if (status === 'OVERDUE') query += `&overdue_only=true`;
    else if (status) query += `&status=${encodeURIComponent(status)}`;

    const res = await fetch(query, {
      headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}
    });
    const invoices = await res.json();

    const tbody = document.getElementById('invoicesTableBody');
    if (!invoices || invoices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500">No invoices found.</td></tr>`;
      return;
    }

    tbody.innerHTML = invoices.map(i => {
      let badgeClass = 'badge-draft';
      if (i.status === 'Paid') badgeClass = 'badge-paid';
      else if (i.is_overdue) badgeClass = 'badge-overdue';
      else if (i.status === 'Confirmed') badgeClass = 'badge-confirmed';

      const statusText = i.is_overdue ? 'OVERDUE' : i.status;

      return `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="py-3 px-4 font-mono font-bold text-blue-400 cursor-pointer" onclick="viewInvoice('${i.id}')">
            ${i.invoice_number}
          </td>
          <td class="py-3 px-4">
            <div class="font-semibold text-slate-200">${escapeHtml(i.customer_name)}</div>
            <div class="text-[11px] text-slate-400">${escapeHtml(i.company_name || '')}</div>
          </td>
          <td class="py-3 px-4 font-mono text-slate-400">${i.issue_date}</td>
          <td class="py-3 px-4 font-mono ${i.is_overdue ? 'text-rose-400 font-bold' : 'text-slate-300'}">${i.due_date}</td>
          <td class="py-3 px-4 font-mono font-bold text-white">${formatCurrency(i.total_amount)}</td>
          <td class="py-3 px-4 font-mono font-bold ${i.balance_due > 0 ? 'text-rose-400' : 'text-slate-400'}">
            ${formatCurrency(i.balance_due)}
          </td>
          <td class="py-3 px-4">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
              ${statusText}
            </span>
          </td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="viewInvoice('${i.id}')" class="p-1 text-slate-400 hover:text-blue-400" title="View & Print">
                <i data-lucide="eye" class="w-4 h-4"></i>
              </button>
              ${i.status !== 'Paid' && i.status !== 'Cancelled' ? `
                <button onclick="openRecordPaymentForInvoice('${i.id}')" class="p-1 text-slate-400 hover:text-emerald-400" title="Record Payment">
                  <i data-lucide="credit-card" class="w-4 h-4"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load invoices:', err);
  }
  lucide.createIcons();
}

async function viewInvoice(invoiceId) {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}
    });
    const inv = await res.json();
    if (!res.ok) throw new Error(inv.error || 'Failed to fetch invoice');

    document.getElementById('invModalNumber').innerText = inv.invoice_number;
    document.getElementById('invModalCustomerName').innerText = inv.customer_name;
    document.getElementById('invModalCustomerEmail').innerText = inv.customer_email;
    document.getElementById('invModalCustomerAddress').innerText = inv.customer_address || '';
    document.getElementById('invModalIssueDate').innerText = inv.issue_date;
    document.getElementById('invModalDueDate').innerText = inv.due_date;
    document.getElementById('invModalSubNumber').innerText = inv.subscription_number || 'Direct';
    document.getElementById('invModalPeriod').innerText = `${inv.billing_period_start || ''} &rarr; ${inv.billing_period_end || ''}`;

    // Status Badge
    const badgeEl = document.getElementById('invModalStatusBadge');
    badgeEl.innerText = inv.is_overdue ? 'OVERDUE' : inv.status;
    badgeEl.className = `px-2.5 py-1 rounded-full text-xs font-mono font-bold ${inv.status === 'Paid' ? 'badge-paid' : (inv.is_overdue ? 'badge-overdue' : 'badge-confirmed')}`;

    // Lines
    const linesBody = document.getElementById('invModalLinesBody');
    linesBody.innerHTML = inv.lines.map(l => `
      <tr>
        <td class="py-2.5 px-3">
          <div class="font-medium text-slate-200">${escapeHtml(l.description)}</div>
        </td>
        <td class="py-2.5 px-3 text-center font-mono text-slate-300">${l.quantity}</td>
        <td class="py-2.5 px-3 text-right font-mono text-slate-300">${formatCurrency(l.unit_price)}</td>
        <td class="py-2.5 px-3 text-right text-slate-400">${escapeHtml(l.tax_name || 'None')} (${l.tax_rate}%)</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-white">${formatCurrency(l.line_total)}</td>
      </tr>
    `).join('');

    // Totals
    document.getElementById('invModalSubtotal').innerText = formatCurrency(inv.subtotal);
    document.getElementById('invModalDiscounts').innerText = `-${formatCurrency(inv.discount_total)}`;
    document.getElementById('invModalTaxes').innerText = `+${formatCurrency(inv.tax_total)}`;
    document.getElementById('invModalTotal').innerText = formatCurrency(inv.total_amount);
    document.getElementById('invModalPaid').innerText = formatCurrency(inv.amount_paid);
    document.getElementById('invModalBalance').innerText = formatCurrency(inv.balance_due);

    // Payments
    const payList = document.getElementById('invModalPaymentsList');
    if (!inv.payments || inv.payments.length === 0) {
      payList.innerHTML = `<div class="text-slate-500 italic text-[11px]">No payments recorded yet.</div>`;
    } else {
      payList.innerHTML = inv.payments.map(p => `
        <div class="flex justify-between items-center text-[11px] p-2 bg-slate-950 rounded border border-slate-800">
          <span class="font-mono text-emerald-400 font-bold">${p.payment_number}</span>
          <span class="text-slate-300">${p.payment_method} &bull; ${p.payment_date}</span>
          <span class="text-slate-400 italic">${escapeHtml(p.reference_note || '')}</span>
          <span class="font-mono font-bold text-white">${formatCurrency(p.amount)}</span>
        </div>
      `).join('');
    }

    // State Action Buttons
    const stateActions = document.getElementById('invModalStateActions');
    stateActions.innerHTML = '';

    if (inv.status === 'Draft') {
      stateActions.innerHTML += `
        <button onclick="updateInvoiceStatusAction('${inv.id}', 'Confirmed')" class="bg-blue-600 hover:bg-blue-500 text-white font-medium px-3 py-1.5 rounded-lg transition">Confirm Invoice</button>
        <button onclick="sendInvoiceAction('${inv.id}')" class="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition">Send</button>
      `;
    } else if (inv.status === 'Confirmed') {
      stateActions.innerHTML += `
        <button onclick="sendInvoiceAction('${inv.id}')" class="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition">Resend Email</button>
      `;
    }

    // Pay Button visibility
    const payBtn = document.getElementById('btnInvModalPay');
    if (inv.status === 'Paid' || inv.status === 'Cancelled') {
      payBtn.style.display = 'none';
    } else {
      payBtn.style.display = 'inline-flex';
      payBtn.onclick = () => openRecordPaymentForInvoice(inv.id);
    }

    openModal('modalInvoice');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function updateInvoiceStatusAction(id, status) {
  try {
    const res = await fetch(`/api/invoices/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Status update failed');
    showToast(`Invoice marked as ${status}`);
    viewInvoice(id);
    loadInvoices();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function sendInvoiceAction(id) {
  try {
    const res = await fetch(`/api/invoices/${id}/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) throw new Error('Send failed');
    showToast('Invoice sent to customer email');
    viewInvoice(id);
    loadInvoices();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 5: PAYMENTS LEDGER
// ----------------------------------------------------
async function loadPayments() {
  try {
    const res = await fetch('/api/payments');
    const payments = await res.json();

    const tbody = document.getElementById('paymentsTableBody');
    if (!payments || payments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500">No payments recorded.</td></tr>`;
      return;
    }

    tbody.innerHTML = payments.map(p => `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="py-3 px-4 font-mono font-bold text-emerald-400">${p.payment_number}</td>
        <td class="py-3 px-4 font-mono font-bold text-blue-400 cursor-pointer" onclick="viewInvoice('${p.invoice_id}')">
          ${p.invoice_number}
        </td>
        <td class="py-3 px-4 text-slate-200">${escapeHtml(p.customer_name)}</td>
        <td class="py-3 px-4 text-slate-300">
          <span class="bg-slate-800 px-2 py-0.5 rounded text-[11px] border border-slate-700">${p.payment_method}</span>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-emerald-400">${formatCurrency(p.amount)}</td>
        <td class="py-3 px-4 font-mono text-slate-400">${p.payment_date}</td>
        <td class="py-3 px-4 text-slate-400">${escapeHtml(p.recorded_by || 'System')}</td>
        <td class="py-3 px-4 text-slate-400 italic">${escapeHtml(p.reference_note || '')}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load payments:', err);
  }
}

function openRecordPaymentModal() {
  openRecordPaymentForInvoice(null);
}

async function openRecordPaymentForInvoice(invoiceId = null) {
  try {
    const res = await fetch('/api/invoices');
    const invoices = await res.json();
    const unpaid = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');

    const select = document.getElementById('payInvoiceSelect');
    select.innerHTML = '<option value="">Select unpaid invoice...</option>' +
      unpaid.map(i => `<option value="${i.id}" data-balance="${i.balance_due}">
        ${i.invoice_number} - ${escapeHtml(i.customer_name)} (Owed: ${formatCurrency(i.balance_due)})
      </option>`).join('');

    if (invoiceId) {
      select.value = invoiceId;
    }

    document.getElementById('payDateInput').value = new Date().toISOString().split('T')[0];
    updatePayInvoiceDetails();
    openModal('modalPayment');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updatePayInvoiceDetails() {
  const select = document.getElementById('payInvoiceSelect');
  const selectedOption = select.options[select.selectedIndex];
  const balance = selectedOption ? parseFloat(selectedOption.getAttribute('data-balance') || 0) : 0;

  document.getElementById('payInvoiceBalanceNote').innerText = `Outstanding Balance: ${formatCurrency(balance)}`;
  document.getElementById('payAmountInput').value = balance > 0 ? balance.toFixed(2) : '';
}

async function handleFormPayment(e) {
  e.preventDefault();
  const invoiceId = document.getElementById('payInvoiceSelect').value;
  const amount = parseFloat(document.getElementById('payAmountInput').value);
  const paymentMethod = document.getElementById('payMethodSelect').value;
  const paymentDate = document.getElementById('payDateInput').value;
  const referenceNote = document.getElementById('payRefInput').value;

  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        invoice_id: invoiceId,
        amount,
        payment_method: paymentMethod,
        payment_date: paymentDate,
        reference_note: referenceNote
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment failed');

    showToast(`Payment ${data.payment.payment_number} of ${formatCurrency(amount)} recorded!`);
    closeModal('modalPayment');
    loadPayments();
    loadInvoices();
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 6: PRODUCTS & VARIANTS
// ----------------------------------------------------
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const products = await res.json();
    cachedProducts = products;

    const grid = document.getElementById('productsCardsGrid');
    grid.innerHTML = products.map(p => `
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-3 relative">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
              ${p.type}
            </span>
            <h3 class="text-base font-bold text-white mt-2">${escapeHtml(p.name)}</h3>
          </div>
          <div class="text-right">
            <div class="text-base font-mono font-bold text-emerald-400">${formatCurrency(p.sales_price)}</div>
            <div class="text-[10px] text-slate-500 font-mono">Cost: ${formatCurrency(p.cost_price)}</div>
          </div>
        </div>
        <p class="text-xs text-slate-400 line-clamp-2">${escapeHtml(p.notes || 'No description.')}</p>

        <!-- Variants Pill Box -->
        ${p.variants && p.variants.length > 0 ? `
          <div class="border-t border-slate-800 pt-3">
            <span class="text-[10px] uppercase font-semibold text-slate-500 block mb-1.5">Configured Variants:</span>
            <div class="flex flex-wrap gap-1.5">
              ${p.variants.map(v => `
                <span class="text-[11px] bg-slate-900 px-2 py-1 rounded border border-slate-800 text-slate-300 flex items-center gap-1">
                  <strong>${escapeHtml(v.attribute_name)}:</strong> ${escapeHtml(v.option_name)}
                  <span class="text-emerald-400 font-mono font-bold">[+${formatCurrency(v.price_adjustment)}]</span>
                </span>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="border-t border-slate-800 pt-3 text-[11px] text-slate-500 italic">No variants configured.</div>
        `}
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load products:', err);
  }
  lucide.createIcons();
}

function openNewProductModal() {
  document.getElementById('formProduct').reset();
  const cont = document.getElementById('productVariantsContainer');
  cont.innerHTML = '';
  // Add sample variant row matching scene: "where choosing the Odoo brand adds 560 to the price"
  addProductVariantRow('Brand', 'Odoo Brand Connector', 560);
  openModal('modalProduct');
}

function addProductVariantRow(attr = '', opt = '', adj = 0) {
  const cont = document.getElementById('productVariantsContainer');
  const div = document.createElement('div');
  div.className = 'grid grid-cols-12 gap-2 items-center variant-row';
  div.innerHTML = `
    <input type="text" placeholder="Attribute (e.g. Brand)" value="${escapeHtml(attr)}" class="col-span-4 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white text-xs" required>
    <input type="text" placeholder="Option (e.g. Odoo)" value="${escapeHtml(opt)}" class="col-span-5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white text-xs" required>
    <input type="number" step="0.01" placeholder="+Price" value="${adj}" class="col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono text-xs" required>
    <button type="button" onclick="this.parentElement.remove()" class="col-span-1 text-slate-500 hover:text-rose-400 flex justify-center">
      <i data-lucide="trash-2" class="w-4 h-4"></i>
    </button>
  `;
  cont.appendChild(div);
  lucide.createIcons();
}

async function handleFormProduct(e) {
  e.preventDefault();
  const name = document.getElementById('prodNameInput').value;
  const type = document.getElementById('prodTypeSelect').value;
  const salesPrice = parseFloat(document.getElementById('prodSalesPriceInput').value);
  const costPrice = parseFloat(document.getElementById('prodCostPriceInput').value);
  const notes = document.getElementById('prodNotesInput').value;

  const variantRows = document.querySelectorAll('#productVariantsContainer .variant-row');
  const variants = [];
  variantRows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    variants.push({
      attribute_name: inputs[0].value,
      option_name: inputs[1].value,
      price_adjustment: parseFloat(inputs[2].value || 0)
    });
  });

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        name,
        type,
        sales_price: salesPrice,
        cost_price: costPrice,
        notes,
        variants
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create product');

    showToast(`Product "${name}" launched!`);
    closeModal('modalProduct');
    loadProducts();
    loadReferenceData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 7: PLANS & POLICIES
// ----------------------------------------------------
async function loadPlans() {
  try {
    const res = await fetch('/api/plans');
    const plans = await res.json();
    cachedPlans = plans;

    const grid = document.getElementById('plansCardsGrid');
    grid.innerHTML = plans.map(p => `
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-4 relative">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30">
              ${p.billing_frequency}
            </span>
            <h3 class="text-base font-bold text-white mt-2">${escapeHtml(p.name)}</h3>
            <div class="text-xs text-slate-400 mt-0.5">Base Product: ${escapeHtml(p.product_name || 'All Products')}</div>
          </div>
          <div class="text-right">
            <div class="text-xl font-mono font-bold text-white">${formatCurrency(p.base_cost)}</div>
            <div class="text-[10px] text-slate-500">per ${p.billing_frequency}</div>
          </div>
        </div>

        <!-- Policy Matrix Flags -->
        <div class="space-y-1.5 border-t border-slate-800 pt-3 text-xs">
          <div class="flex justify-between items-center text-slate-300">
            <span>Auto-close on expiration:</span>
            <span class="font-mono text-[11px] font-bold ${p.auto_close_on_expiry ? 'text-amber-400' : 'text-slate-500'}">
              ${p.auto_close_on_expiry ? 'YES (Auto)' : 'NO (Manual)'}
            </span>
          </div>
          <div class="flex justify-between items-center text-slate-300">
            <span>Early closure allowed:</span>
            <span class="font-mono text-[11px] font-bold ${p.allow_early_close ? 'text-emerald-400' : 'text-rose-400'}">
              ${p.allow_early_close ? 'ALLOWED' : 'BLOCKED'}
            </span>
          </div>
          <div class="flex justify-between items-center text-slate-300">
            <span>Pausing allowed:</span>
            <span class="font-mono text-[11px] font-bold ${p.allow_pause ? 'text-emerald-400' : 'text-rose-400'}">
              ${p.allow_pause ? 'ALLOWED' : 'BLOCKED'}
            </span>
          </div>
          <div class="flex justify-between items-center text-slate-300">
            <span>Renewals allowed:</span>
            <span class="font-mono text-[11px] font-bold ${p.allow_renewal ? 'text-emerald-400' : 'text-rose-400'}">
              ${p.allow_renewal ? 'ALLOWED' : 'BLOCKED'}
            </span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load plans:', err);
  }
}

function openNewPlanModal() {
  document.getElementById('formPlan').reset();
  document.getElementById('planValidFromInput').value = new Date().toISOString().split('T')[0];
  openModal('modalPlan');
}

async function handleFormPlan(e) {
  e.preventDefault();
  const body = {
    name: document.getElementById('planNameInput').value,
    base_cost: parseFloat(document.getElementById('planCostInput').value),
    billing_frequency: document.getElementById('planFreqSelect').value,
    valid_from: document.getElementById('planValidFromInput').value,
    valid_to: document.getElementById('planValidToInput').value || null,
    auto_close_on_expiry: document.getElementById('planAutoCloseCheckbox').checked ? 1 : 0,
    allow_early_close: document.getElementById('planEarlyCloseCheckbox').checked ? 1 : 0,
    allow_pause: document.getElementById('planAllowPauseCheckbox').checked ? 1 : 0,
    allow_renewal: document.getElementById('planAllowRenewalCheckbox').checked ? 1 : 0
  };

  try {
    const res = await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save plan');

    showToast(`Plan "${body.name}" configured!`);
    closeModal('modalPlan');
    loadPlans();
    loadReferenceData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 8: QUOTATION TEMPLATES
// ----------------------------------------------------
async function loadTemplates() {
  try {
    const res = await fetch('/api/quotation-templates');
    const templates = await res.json();
    cachedTemplates = templates;

    const grid = document.getElementById('templatesCardsGrid');
    grid.innerHTML = templates.map(t => `
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="text-base font-bold text-white">${escapeHtml(t.name)}</h3>
            <div class="text-xs text-blue-400 mt-0.5">Plan: ${escapeHtml(t.plan_name)} (${t.billing_frequency})</div>
          </div>
          <span class="text-xs bg-slate-900 border border-slate-700 px-2.5 py-1 rounded-lg text-slate-300 font-mono">
            Valid: ${t.validity_days} days
          </span>
        </div>
        <p class="text-xs text-slate-400">${escapeHtml(t.notes || '')}</p>

        <!-- Template lines preview -->
        <div class="border-t border-slate-800 pt-3 space-y-1.5">
          <span class="text-[10px] uppercase font-semibold text-slate-500 block">Preconfigured Lines:</span>
          ${t.lines.map(l => `
            <div class="flex justify-between text-xs text-slate-300 bg-slate-900/60 p-2 rounded">
              <span>${escapeHtml(l.description || 'Product')}</span>
              <span class="font-mono text-slate-400 font-semibold">Qty: ${l.quantity || 1}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

function openNewTemplateModal() {
  showToast('Standard quotation templates loaded. You can select one when creating a new quote.', 'info');
  openNewSubscriptionModal();
}

// ----------------------------------------------------
// TAB 9: TAXES & DISCOUNTS (ADMIN ONLY)
// ----------------------------------------------------
async function loadDiscountsAndTaxes() {
  try {
    const [txRes, dRes] = await Promise.all([
      fetch('/api/taxes'),
      fetch('/api/discounts')
    ]);
    const taxes = await txRes.json();
    const discounts = await dRes.json();

    // Render Taxes
    const taxesCont = document.getElementById('taxesListContainer');
    taxesCont.innerHTML = taxes.map(t => `
      <div class="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
        <div>
          <div class="font-semibold text-white flex items-center gap-1.5">
            ${escapeHtml(t.name)}
            ${t.is_default ? `<span class="bg-blue-500/20 text-blue-300 text-[10px] px-1.5 py-0.2 rounded border border-blue-500/30">Default</span>` : ''}
          </div>
          <div class="text-slate-400 text-[11px] mt-0.5">${escapeHtml(t.description || '')}</div>
        </div>
        <div class="text-right">
          <span class="text-base font-bold font-mono text-emerald-400">${t.rate}%</span>
        </div>
      </div>
    `).join('');

    // Render Discounts
    const discCont = document.getElementById('discountsListContainer');
    discCont.innerHTML = discounts.map(d => `
      <div class="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2 text-xs">
        <div class="flex justify-between items-start">
          <div>
            <span class="font-mono font-bold text-amber-400 text-sm tracking-wide">${d.code}</span>
            <div class="text-white font-medium mt-0.5">${escapeHtml(d.name)}</div>
          </div>
          <span class="font-mono font-bold text-sm ${d.discount_type === 'percentage' ? 'text-indigo-400' : 'text-emerald-400'}">
            ${d.discount_type === 'percentage' ? `${d.discount_value}% OFF` : `-$${d.discount_value}`}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
          <div>Min: $${d.min_purchase_amount} (${d.min_quantity} seats)</div>
          <div>Valid: ${d.start_date} &rarr; ${d.end_date}</div>
          <div>Usage: ${d.used_count} / ${d.max_uses === 0 ? '&infin;' : d.max_uses} uses</div>
          <div class="capitalize">Scope: ${d.scope}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load discounts & taxes:', err);
  }
}

function openNewTaxModal() {
  const name = prompt('Tax Rule Name (e.g. EU Digital Services Tax):');
  if (!name) return;
  const rate = parseFloat(prompt('Tax Rate % (e.g. 19.5):') || '0');
  if (isNaN(rate)) return;

  fetch('/api/taxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
    body: JSON.stringify({ name, rate, is_default: 0 })
  }).then(r => r.json()).then(() => {
    showToast(`Tax rule "${name}" created!`);
    loadDiscountsAndTaxes();
  }).catch(e => showToast(e.message, 'error'));
}

function openNewDiscountModal() {
  document.getElementById('formDiscount').reset();
  document.getElementById('discStartInput').value = new Date().toISOString().split('T')[0];
  document.getElementById('discEndInput').value = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  openModal('modalDiscount');
}

async function handleFormDiscount(e) {
  e.preventDefault();
  const body = {
    code: document.getElementById('discCodeInput').value,
    name: document.getElementById('discNameInput').value,
    discount_type: document.getElementById('discTypeSelect').value,
    discount_value: parseFloat(document.getElementById('discValueInput').value),
    min_purchase_amount: parseFloat(document.getElementById('discMinAmountInput').value || 0),
    min_quantity: parseInt(document.getElementById('discMinQtyInput').value || 0),
    start_date: document.getElementById('discStartInput').value,
    end_date: document.getElementById('discEndInput').value,
    max_uses: parseInt(document.getElementById('discMaxUsesInput').value || 0),
    scope: document.getElementById('discScopeSelect').value
  };

  try {
    const res = await fetch('/api/discounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save discount rule');

    showToast(`Discount rule ${body.code} saved!`);
    closeModal('modalDiscount');
    loadDiscountsAndTaxes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 10: STAFF MANAGEMENT (ADMIN ONLY)
// ----------------------------------------------------
async function loadStaff() {
  try {
    const res = await fetch('/api/staff', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const staff = await res.json();

    const tbody = document.getElementById('staffTableBody');
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-rose-400">Access Denied: Admin authorization required.</td></tr>`;
      return;
    }

    tbody.innerHTML = staff.map(s => `
      <tr class="hover:bg-slate-900/60 transition">
        <td class="py-3 px-4 font-semibold text-white">${escapeHtml(s.name)}</td>
        <td class="py-3 px-4 text-slate-300 font-mono">${escapeHtml(s.email)}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${s.role === 'admin' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
            ${s.role}
          </span>
        </td>
        <td class="py-3 px-4 text-slate-400">
          ${s.role === 'admin' ? 'Full Administrator Access' : 'Internal Staff (Day-to-day work, Billing, Quotes)'}
        </td>
        <td class="py-3 px-4 text-slate-500 font-mono text-[11px]">${s.created_at.split('T')[0]}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load staff:', err);
  }
}

function openAddStaffModal() {
  document.getElementById('formAddStaff').reset();
  openModal('modalStaff');
}

async function handleFormAddStaff(e) {
  e.preventDefault();
  const name = document.getElementById('staffNameInput').value;
  const email = document.getElementById('staffEmailInput').value;
  const password = document.getElementById('staffPassInput').value;
  const role = document.getElementById('staffRoleSelect').value;

  try {
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add staff');

    showToast(`Staff member ${name} created!`);
    closeModal('modalStaff');
    loadStaff();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 11: CUSTOMER SELF-SERVICE PORTAL
// ----------------------------------------------------
async function loadCustomerPortal() {
  try {
    // If not logged in as a customer, switch to Alice Miller demo account
    if (!currentUser || currentUser.role !== 'customer') {
      await loginAs('alice@acmeshop.com', 'Customer@2026', false);
    }

    const [subRes, invRes] = await Promise.all([
      fetch(`/api/subscriptions?customer_id=${currentUser.customerId}`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      }),
      fetch(`/api/invoices?customer_id=${currentUser.customerId}`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      })
    ]);

    const subs = await subRes.json();
    const invoices = await invRes.json();

    // Render Subscriptions with Add-On Toggles
    const container = document.getElementById('customerSubsContainer');
    if (!subs || subs.length === 0) {
      container.innerHTML = `<div class="p-6 bg-slate-950/70 border border-slate-800 rounded-2xl text-center text-slate-400">No active subscriptions registered for this customer account.</div>`;
    } else {
      // Fetch full details of each subscription to display line toggles
      const fullSubs = await Promise.all(subs.map(s => fetch(`/api/subscriptions/${s.id}`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      }).then(r => r.json())));

      container.innerHTML = fullSubs.map(s => `
        <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <span class="font-mono text-xs font-bold text-emerald-400">${s.subscription_number}</span>
              <h3 class="text-base font-bold text-white mt-0.5">${escapeHtml(s.plan_name)}</h3>
              <div class="text-xs text-slate-400">Billed ${s.billing_frequency} &bull; Next billing: <span class="font-mono text-slate-200">${s.next_billing_date}</span></div>
            </div>
            <div class="text-right">
              <div class="text-xl font-bold font-mono text-white">${formatCurrency(s.recurring_total)}</div>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadgeClass(s.status)}">
                ${s.status}
              </span>
            </div>
          </div>

          <!-- Add-ons / Lines Interactive Self-Service Toggles -->
          <div class="space-y-2">
            <h4 class="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <i data-lucide="toggle-left" class="w-3.5 h-3.5 text-blue-400"></i> Manage Subscription Add-Ons & Features
            </h4>
            <div class="space-y-2">
              ${s.lines.map(l => `
                <div class="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                  <div class="space-y-0.5">
                    <div class="font-semibold text-slate-200 flex items-center gap-2">
                      ${escapeHtml(l.description)}
                      ${l.is_addon ? `<span class="bg-blue-500/20 text-blue-300 text-[10px] px-1.5 py-0.2 rounded">Add-on</span>` : ''}
                    </div>
                    <div class="text-slate-400 text-[11px] font-mono">
                      Rate: ${formatCurrency(l.unit_price)} &bull; Qty: ${l.quantity}
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="font-mono font-bold ${l.active ? 'text-emerald-400' : 'text-slate-500'}">
                      ${l.active ? `+${formatCurrency(l.unit_price * l.quantity)}` : 'OFF ($0)'}
                    </span>
                    ${l.is_addon ? `
                      <label class="switch">
                        <input type="checkbox" ${l.active ? 'checked' : ''} onchange="toggleAddonOnline('${s.id}', '${l.id}', this.checked)">
                        <span class="slider"></span>
                      </label>
                    ` : `
                      <span class="text-[10px] text-slate-500 font-mono">Core</span>
                    `}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('');
    }

    // Render Invoices & Online Pay
    const invTbody = document.getElementById('customerInvoicesTableBody');
    if (!invoices || invoices.length === 0) {
      invTbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500">No invoices for your account.</td></tr>`;
    } else {
      invTbody.innerHTML = invoices.map(i => `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="py-3 px-4 font-mono font-bold text-blue-400 cursor-pointer" onclick="viewInvoice('${i.id}')">
            ${i.invoice_number}
          </td>
          <td class="py-3 px-4 font-mono text-slate-400">${i.issue_date}</td>
          <td class="py-3 px-4 font-mono ${i.is_overdue ? 'text-rose-400 font-bold' : 'text-slate-300'}">${i.due_date}</td>
          <td class="py-3 px-4 font-mono font-bold text-white">${formatCurrency(i.total_amount)}</td>
          <td class="py-3 px-4 font-mono font-bold ${i.balance_due > 0 ? 'text-rose-400' : 'text-slate-400'}">
            ${formatCurrency(i.balance_due)}
          </td>
          <td class="py-3 px-4">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${i.status === 'Paid' ? 'badge-paid' : (i.is_overdue ? 'badge-overdue' : 'badge-confirmed')}">
              ${i.is_overdue ? 'OVERDUE' : i.status}
            </span>
          </td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-2">
              <button onclick="viewInvoice('${i.id}')" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded transition">View / PDF</button>
              ${i.status !== 'Paid' ? `
                <button onclick="openRecordPaymentForInvoice('${i.id}')" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1 rounded transition">Pay Online</button>
              ` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load customer portal:', err);
  }
  lucide.createIcons();
}

async function toggleAddonOnline(subId, lineId, activeState) {
  try {
    const res = await fetch(`/api/subscriptions/${subId}/toggle-addon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ line_id: lineId, active: activeState })
    });
    const sub = await res.json();
    if (!res.ok) throw new Error(sub.error || 'Failed to toggle add-on');

    showToast(`Add-on switched ${activeState ? 'ON' : 'OFF'}! Next bill updated to ${formatCurrency(sub.recurring_total)}`);
    loadCustomerPortal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// TAB 12: AUDIT TRAIL
// ----------------------------------------------------
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/analytics/audit-logs');
    const logs = await res.json();

    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = logs.map(l => `
      <tr class="hover:bg-slate-900/60 transition text-[11px]">
        <td class="py-2.5 px-4 text-slate-500">${l.timestamp.replace('T', ' ').substring(0, 19)}</td>
        <td class="py-2.5 px-4 font-semibold text-slate-300 font-sans">${escapeHtml(l.user_name || 'System')}</td>
        <td class="py-2.5 px-4 text-blue-400 font-bold">${l.action}</td>
        <td class="py-2.5 px-4 text-slate-400 uppercase">${l.entity_type}</td>
        <td class="py-2.5 px-4 text-slate-300 font-sans">${escapeHtml(l.details || '')}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load audit logs:', err);
  }
}

// ----------------------------------------------------
// NEW SUBSCRIPTION / QUOTE BUILDER
// ----------------------------------------------------
function openNewSubscriptionModal() {
  document.getElementById('formNewSub').reset();
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('newSubStartDate').value = todayStr;

  const linesCont = document.getElementById('newSubLinesContainer');
  linesCont.innerHTML = '';
  addNewSubLineRow();

  openModal('modalNewSub');
}

function addNewSubLineRow(productId = '', variantId = '', qty = 1, desc = '') {
  const cont = document.getElementById('newSubLinesContainer');
  const div = document.createElement('div');
  div.className = 'grid grid-cols-12 gap-2 items-center sub-line-row bg-slate-950 p-2.5 rounded-xl border border-slate-800';

  div.innerHTML = `
    <div class="col-span-5">
      <select class="line-product-select w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs" onchange="handleLineProductChange(this)" required>
        <option value="">Select product...</option>
        ${cachedProducts.map(p => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${escapeHtml(p.name)} ($${p.sales_price})</option>`).join('')}
      </select>
    </div>
    <div class="col-span-4">
      <select class="line-variant-select w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs">
        <option value="">Standard Edition (+$0)</option>
      </select>
    </div>
    <div class="col-span-2">
      <input type="number" min="1" value="${qty}" class="line-qty-input w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white font-mono text-xs" placeholder="Qty">
    </div>
    <div class="col-span-1 flex justify-center">
      <button type="button" onclick="this.closest('.sub-line-row').remove()" class="text-slate-500 hover:text-rose-400">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  cont.appendChild(div);

  // If productId given, populate variants
  const select = div.querySelector('.line-product-select');
  if (productId) {
    populateLineVariants(div, productId, variantId);
  }

  lucide.createIcons();
}

function handleLineProductChange(selectEl) {
  const row = selectEl.closest('.sub-line-row');
  populateLineVariants(row, selectEl.value, null);
}

function populateLineVariants(row, productId, selectedVariantId) {
  const variantSelect = row.querySelector('.line-variant-select');
  const prod = cachedProducts.find(p => p.id === productId);

  if (!prod || !prod.variants || prod.variants.length === 0) {
    variantSelect.innerHTML = '<option value="">Standard (+$0)</option>';
    return;
  }

  variantSelect.innerHTML = '<option value="">Standard (+$0)</option>' +
    prod.variants.map(v => `<option value="${v.id}" ${v.id === selectedVariantId ? 'selected' : ''}>
      ${escapeHtml(v.attribute_name)}: ${escapeHtml(v.option_name)} (+${formatCurrency(v.price_adjustment)})
    </option>`).join('');
}

function applyTemplateToNewSub() {
  const tmplId = document.getElementById('newSubTemplateSelect').value;
  if (!tmplId) return;

  const tmpl = cachedTemplates.find(t => t.id === tmplId);
  if (!tmpl) return;

  document.getElementById('newSubPlanSelect').value = tmpl.plan_id;
  document.getElementById('newSubNotes').value = tmpl.notes || '';

  const linesCont = document.getElementById('newSubLinesContainer');
  linesCont.innerHTML = '';

  for (const l of tmpl.lines) {
    addNewSubLineRow(l.product_id, l.variant_id, l.quantity || 1, l.description || '');
  }
}

function handlePlanSelectChange() {
  // If plan has base product and lines are empty, add that product
  const planId = document.getElementById('newSubPlanSelect').value;
  const plan = cachedPlans.find(p => p.id === planId);
  const linesCont = document.getElementById('newSubLinesContainer');

  if (plan && plan.product_id && linesCont.children.length === 0) {
    addNewSubLineRow(plan.product_id);
  }
}

async function handleFormNewSub(e) {
  e.preventDefault();
  const customerId = document.getElementById('newSubCustomerSelect').value;
  const planId = document.getElementById('newSubPlanSelect').value;
  const startDate = document.getElementById('newSubStartDate').value;
  const expiryDate = document.getElementById('newSubExpiryDate').value || null;
  const paymentTerms = document.getElementById('newSubTermsSelect').value;
  const notes = document.getElementById('newSubNotes').value;

  const rows = document.querySelectorAll('#newSubLinesContainer .sub-line-row');
  const lines = [];

  rows.forEach(row => {
    const prodId = row.querySelector('.line-product-select').value;
    const varId = row.querySelector('.line-variant-select').value || null;
    const qty = parseInt(row.querySelector('.line-qty-input').value || 1);

    if (prodId) {
      lines.push({
        product_id: prodId,
        variant_id: varId,
        quantity: qty
      });
    }
  });

  if (lines.length === 0) {
    showToast('Please add at least one product line', 'error');
    return;
  }

  try {
    const res = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        customer_id: customerId,
        plan_id: planId,
        start_date: startDate,
        expiry_date: expiryDate,
        payment_terms: paymentTerms,
        notes,
        lines
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create subscription');

    showToast(`Quotation / Subscription ${data.subscription_number} created!`);
    closeModal('modalNewSub');
    switchTab('subscriptions');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// AUTH FORM HANDLERS & PASSWORD RULES CHECKER
// ----------------------------------------------------
function switchAuthMode(mode) {
  document.getElementById('tabAuthSignin').className = mode === 'signin' ? 'pb-2.5 px-4 text-blue-400 border-b-2 border-blue-500' : 'pb-2.5 px-4 text-slate-400 hover:text-white';
  document.getElementById('tabAuthSignup').className = mode === 'signup' ? 'pb-2.5 px-4 text-blue-400 border-b-2 border-blue-500' : 'pb-2.5 px-4 text-slate-400 hover:text-white';
  document.getElementById('tabAuthForgot').className = mode === 'forgot' ? 'pb-2.5 px-4 text-blue-400 border-b-2 border-blue-500' : 'pb-2.5 px-4 text-slate-400 hover:text-white';

  document.getElementById('formSignIn').classList.toggle('hidden', mode !== 'signin');
  document.getElementById('formSignUp').classList.toggle('hidden', mode !== 'signup');
  document.getElementById('formForgot').classList.toggle('hidden', mode !== 'forgot');
}

function checkPasswordStrength(password) {
  const hasLen = password.length > 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  updateRuleUI('rule-length', hasLen);
  updateRuleUI('rule-upper', hasUpper);
  updateRuleUI('rule-lower', hasLower);
  updateRuleUI('rule-special', hasSpecial);

  lucide.createIcons();
}

function updateRuleUI(elId, valid) {
  const el = document.getElementById(elId);
  if (valid) {
    el.className = 'text-emerald-400 flex items-center gap-1.5 font-medium';
    el.innerHTML = '<i data-lucide="check-circle-2" class="w-3 h-3 text-emerald-400"></i> ' + el.innerText.trim();
  } else {
    el.className = 'text-slate-500 flex items-center gap-1.5';
    el.innerHTML = '<i data-lucide="circle" class="w-3 h-3 text-slate-500"></i> ' + el.innerText.trim();
  }
}

async function handleFormSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('signInEmail').value;
  const password = document.getElementById('signInPassword').value;
  await loginAs(email, password);
  closeModal('modalAuth');
}

async function handleFormSignUp(e) {
  e.preventDefault();
  const name = document.getElementById('signUpName').value;
  const email = document.getElementById('signUpEmail').value;
  const password = document.getElementById('signUpPassword').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role: 'customer' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    showToast('Account created successfully! Logging you in...');
    await loginAs(email, password, false);
    closeModal('modalAuth');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleFormForgot(e) {
  e.preventDefault();
  const email = document.getElementById('forgotEmail').value;

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    const box = document.getElementById('forgotSuccessBox');
    box.classList.remove('hidden');

    if (data.resetToken) {
      box.innerHTML = `
        <div class="font-bold">Reset link generated!</div>
        <div class="mt-1 font-mono text-[10px] break-all">Token: ${data.resetToken}</div>
        <div class="mt-2 text-slate-300">In production an email is sent. For demo, click below:</div>
        <button type="button" onclick="simulateTokenReset('${data.resetToken}')" class="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded transition">
          Test Reset Password Now
        </button>
      `;
    } else {
      box.innerText = data.message;
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function simulateTokenReset(token) {
  const newPass = prompt('Enter new strong password (>8 chars, uppercase, lowercase, special):', 'NewPass123!');
  if (!newPass) return;

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: newPass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset failed');

    showToast('Password updated! You can now log in.');
    switchAuthMode('signin');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reseedDatabase() {
  if (!confirm('Reset Brightloop database back to default state with all demo scenarios?')) return;
  try {
    const res = await fetch('/api/system/seed', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Database reset');
    await loadReferenceData();
    switchTab('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// UI UTILITIES
// ----------------------------------------------------
function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('hidden');
  lucide.createIcons();
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
}

function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'Draft': return 'badge-draft';
    case 'Quotation': return 'badge-quotation';
    case 'Confirmed': return 'badge-confirmed';
    case 'Active': return 'badge-active';
    case 'Paused': return 'badge-paused';
    case 'Closed': return 'badge-closed';
    case 'Paid': return 'badge-paid';
    default: return 'badge-draft';
  }
}

