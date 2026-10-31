const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

function getNextSubscriptionNumber() {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const prefix = `SUB-${year}-`;
  
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM subscriptions WHERE subscription_number LIKE ?
  `).get(`${prefix}%`);

  const nextSeq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

function calculateNextBillingDate(fromDateStr, frequency) {
  const date = new Date(fromDateStr);
  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
    case 'monthly':
    default:
      date.setMonth(date.getMonth() + 1);
      break;
  }
  return date.toISOString().split('T')[0];
}

function createProduct({ name, type, sales_price, cost_price, notes = '', variants = [] }) {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, name, type, parseFloat(sales_price), parseFloat(cost_price), notes, now);

  if (Array.isArray(variants)) {
    for (const v of variants) {
      const variantId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO product_variants (id, product_id, attribute_name, option_name, price_adjustment, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(variantId, id, v.attribute_name, v.option_name, parseFloat(v.price_adjustment || 0), now);
    }
  }

  return getProductById(id);
}

function getProductById(id) {
  const db = getDatabase();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return null;

  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').all(id);
  return { ...product, variants };
}

function listProducts() {
  const db = getDatabase();
  const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name ASC').all();
  return products.map(p => {
    const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').all(p.id);
    return { ...p, variants };
  });
}

function createPlan({
  name,
  product_id = null,
  base_cost,
  billing_frequency,
  min_quantity = 1,
  valid_from,
  valid_to = null,
  auto_close_on_expiry = 0,
  allow_early_close = 1,
  allow_pause = 1,
  allow_renewal = 1
}) {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO plans (
      id, name, product_id, base_cost, billing_frequency, min_quantity,
      valid_from, valid_to, auto_close_on_expiry, allow_early_close,
      allow_pause, allow_renewal, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id, name, product_id, parseFloat(base_cost), billing_frequency, parseInt(min_quantity),
    valid_from, valid_to, auto_close_on_expiry ? 1 : 0, allow_early_close ? 1 : 0,
    allow_pause ? 1 : 0, allow_renewal ? 1 : 0, now
  );

  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
}

function listPlans() {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, pr.name as product_name
    FROM plans p
    LEFT JOIN products pr ON p.product_id = pr.id
    WHERE p.active = 1
    ORDER BY p.name ASC
  `).all();
}

function createQuotationTemplate({ name, plan_id, validity_days = 30, lines = [], notes = '' }) {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO quotation_templates (id, name, plan_id, validity_days, lines_json, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, plan_id, parseInt(validity_days), JSON.stringify(lines), notes, now);

  return getQuotationTemplateById(id);
}

function getQuotationTemplateById(id) {
  const db = getDatabase();
  const r = db.prepare(`
    SELECT qt.*, p.name as plan_name, p.billing_frequency, p.base_cost
    FROM quotation_templates qt
    JOIN plans p ON qt.plan_id = p.id
    WHERE qt.id = ?
  `).get(id);

  if (!r) return null;
  return { ...r, lines: JSON.parse(r.lines_json || '[]') };
}

function listQuotationTemplates() {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT qt.*, p.name as plan_name, p.billing_frequency, p.base_cost
    FROM quotation_templates qt
    JOIN plans p ON qt.plan_id = p.id
    ORDER BY qt.name ASC
  `).all();

  return rows.map(r => ({ ...r, lines: JSON.parse(r.lines_json || '[]') }));
}

function createSubscription({
  customer_id,
  plan_id,
  start_date = null,
  expiry_date = null,
  payment_terms = 'Net 30',
  notes = '',
  lines = []
}) {
  const db = getDatabase();
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan_id);
  if (!plan) throw new Error('Selected plan does not exist');

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) throw new Error('Selected customer does not exist');

  const id = crypto.randomUUID();
  const subNumber = getNextSubscriptionNumber();
  const now = new Date().toISOString();
  const startDate = start_date || now.split('T')[0];
  const nextBilling = startDate; // Initially billable on start date

  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, subNumber, customer_id, plan_id, startDate, expiry_date, nextBilling, payment_terms, notes, now, now);

  // Add line items
  for (const line of lines) {
    addLineToSubscription(id, line);
  }

  return getSubscriptionById(id);
}

function addLineToSubscription(subscriptionId, lineData) {
  const db = getDatabase();
  const lineId = crypto.randomUUID();
  
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(lineData.product_id);
  if (!product) throw new Error(`Product not found: ${lineData.product_id}`);

  let unitPrice = product.sales_price;
  let variantId = lineData.variant_id || null;
  let variantDesc = '';

  if (variantId) {
    const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId);
    if (variant) {
      unitPrice += variant.price_adjustment;
      variantDesc = ` (${variant.attribute_name}: ${variant.option_name} [+$${variant.price_adjustment}])`;
    }
  }

  const quantity = parseInt(lineData.quantity || 1);
  const isAddon = lineData.is_addon || (product.type === 'addon' ? 1 : 0);
  const active = lineData.active !== undefined ? (lineData.active ? 1 : 0) : 1;
  const description = (lineData.description || product.name) + variantDesc;
  const lineTotal = active ? (unitPrice * quantity) : 0;

  db.prepare(`
    INSERT INTO subscription_lines (
      id, subscription_id, product_id, variant_id, description,
      quantity, unit_price, tax_id, discount_id, discount_amount, line_total, is_addon, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lineId, subscriptionId, product.id, variantId, description,
    quantity, unitPrice, lineData.tax_id || null, lineData.discount_id || null,
    parseFloat(lineData.discount_amount || 0), lineTotal, isAddon, active
  );

  return lineId;
}

function getSubscriptionById(id) {
  const db = getDatabase();
  const sub = db.prepare(`
    SELECT s.*, c.name as customer_name, c.email as customer_email, c.company_name,
           p.name as plan_name, p.billing_frequency, p.base_cost,
           p.auto_close_on_expiry, p.allow_early_close, p.allow_pause, p.allow_renewal
    FROM subscriptions s
    JOIN customers c ON s.customer_id = c.id
    JOIN plans p ON s.plan_id = p.id
    WHERE s.id = ?
  `).get(id);

  if (!sub) return null;

  const lines = db.prepare(`
    SELECT sl.*, p.name as product_name, p.type as product_type
    FROM subscription_lines sl
    JOIN products p ON sl.product_id = p.id
    WHERE sl.subscription_id = ?
  `).all(id);

  // Calculate recurring subtotal
  const recurringTotal = lines
    .filter(l => l.active === 1)
    .reduce((sum, l) => sum + (l.unit_price * l.quantity), 0);

  return { ...sub, lines, recurring_total: recurringTotal };
}

function listSubscriptions(filter = {}) {
  const db = getDatabase();
  let query = `
    SELECT s.*, c.name as customer_name, c.email as customer_email, c.company_name,
           p.name as plan_name, p.billing_frequency, p.base_cost,
           p.auto_close_on_expiry, p.allow_early_close, p.allow_pause, p.allow_renewal
    FROM subscriptions s
    JOIN customers c ON s.customer_id = c.id
    JOIN plans p ON s.plan_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.customer_id) {
    query += ' AND s.customer_id = ?';
    params.push(filter.customer_id);
  }
  if (filter.status) {
    query += ' AND s.status = ?';
    params.push(filter.status);
  }
  if (filter.plan_id) {
    query += ' AND s.plan_id = ?';
    params.push(filter.plan_id);
  }
  if (filter.search) {
    query += ' AND (s.subscription_number LIKE ? OR c.name LIKE ? OR c.company_name LIKE ?)';
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY s.created_at DESC';

  const subs = db.prepare(query).all(...params);
  return subs.map(s => {
    const lines = db.prepare('SELECT * FROM subscription_lines WHERE subscription_id = ?').all(s.id);
    const recurringTotal = lines
      .filter(l => l.active === 1)
      .reduce((sum, l) => sum + (l.unit_price * l.quantity), 0);
    return { ...s, line_count: lines.length, recurring_total: recurringTotal };
  });
}

function updateSubscriptionStatus(id, newStatus, user = { name: 'System' }) {
  const db = getDatabase();
  const sub = getSubscriptionById(id);
  if (!sub) throw new Error('Subscription not found');

  const validTransitions = {
    'Draft': ['Quotation', 'Confirmed', 'Closed'],
    'Quotation': ['Confirmed', 'Closed'],
    'Confirmed': ['Active', 'Closed'],
    'Active': ['Paused', 'Closed'],
    'Paused': ['Active', 'Closed'],
    'Closed': sub.allow_renewal ? ['Draft', 'Confirmed', 'Active'] : []
  };

  if (!validTransitions[sub.status] || !validTransitions[sub.status].includes(newStatus)) {
    throw new Error(`Cannot transition subscription from ${sub.status} to ${newStatus}`);
  }

  if (newStatus === 'Paused' && !sub.allow_pause) {
    throw new Error('This plan does not permit pausing subscriptions');
  }

  if (newStatus === 'Closed' && (sub.status === 'Active' || sub.status === 'Paused') && !sub.allow_early_close) {
    const today = new Date().toISOString().split('T')[0];
    if (!sub.expiry_date || sub.expiry_date > today) {
      throw new Error('This plan does not permit early closure before the expiry date');
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE subscriptions
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, now, id);

  // Log audit
  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, user.name, 'UPDATE_STATUS', 'subscription', id,
    `Status changed from ${sub.status} to ${newStatus}`
  );

  return getSubscriptionById(id);
}

function toggleSubscriptionAddon(subscriptionId, lineId, activeState, user = { name: 'Customer' }) {
  const db = getDatabase();
  const line = db.prepare('SELECT * FROM subscription_lines WHERE id = ? AND subscription_id = ?').get(lineId, subscriptionId);
  if (!line) throw new Error('Subscription line not found');

  const newActive = activeState ? 1 : 0;
  const lineTotal = newActive ? (line.unit_price * line.quantity) : 0;

  db.prepare(`
    UPDATE subscription_lines
    SET active = ?, line_total = ?
    WHERE id = ?
  `).run(newActive, lineTotal, lineId);

  const now = new Date().toISOString();
  db.prepare(`UPDATE subscriptions SET updated_at = ? WHERE id = ?`).run(now, subscriptionId);

  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, user.name, 'TOGGLE_ADDON', 'subscription', subscriptionId,
    `Addon line "${line.description}" turned ${newActive ? 'ON' : 'OFF'}`
  );

  return getSubscriptionById(subscriptionId);
}

function autoCloseExpiredSubscriptions() {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const expired = db.prepare(`
    SELECT s.id, s.subscription_number
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.status = 'Active'
      AND p.auto_close_on_expiry = 1
      AND s.expiry_date IS NOT NULL
      AND s.expiry_date < ?
  `).all(today);

  let closedCount = 0;
  const now = new Date().toISOString();

  for (const sub of expired) {
    db.prepare(`UPDATE subscriptions SET status = 'Closed', updated_at = ? WHERE id = ?`).run(now, sub.id);
    db.prepare(`
      INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), now, 'Automated Scheduler', 'AUTO_CLOSE', 'subscription', sub.id,
      `Subscription ${sub.subscription_number} automatically closed upon plan expiration`
    );
    closedCount++;
  }

  return { closedCount, subscriptions: expired };
}

module.exports = {
  getNextSubscriptionNumber,
  calculateNextBillingDate,
  createProduct,
  getProductById,
  listProducts,
  createPlan,
  listPlans,
  createQuotationTemplate,
  getQuotationTemplateById,
  listQuotationTemplates,
  createSubscription,
  addLineToSubscription,
  getSubscriptionById,
  listSubscriptions,
  updateSubscriptionStatus,
  toggleSubscriptionAddon,
  autoCloseExpiredSubscriptions
};
