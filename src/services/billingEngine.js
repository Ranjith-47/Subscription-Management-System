const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { calculateNextBillingDate, getSubscriptionById } = require('./subscriptionService');

function getNextInvoiceNumber() {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM invoices WHERE invoice_number LIKE ?
  `).get(`${prefix}%`);

  const nextSeq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

function calculateDueDate(issueDateStr, paymentTerms) {
  const date = new Date(issueDateStr);
  const terms = (paymentTerms || '').toLowerCase();

  if (terms.includes('15')) {
    date.setDate(date.getDate() + 15);
  } else if (terms.includes('60')) {
    date.setDate(date.getDate() + 60);
  } else if (terms.includes('receipt') || terms.includes('due upon') || terms.includes('immediate')) {
    // Due same day
  } else {
    // Default Net 30
    date.setDate(date.getDate() + 30);
  }
  return date.toISOString().split('T')[0];
}

// Taxes Management
function createTaxRule({ name, rate, description = '', is_default = 0 }) {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (is_default) {
    db.prepare('UPDATE taxes SET is_default = 0').run();
  }

  db.prepare(`
    INSERT INTO taxes (id, name, rate, description, is_default, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(id, name, parseFloat(rate), description, is_default ? 1 : 0, now);

  return db.prepare('SELECT * FROM taxes WHERE id = ?').get(id);
}

function listTaxes() {
  const db = getDatabase();
  return db.prepare('SELECT * FROM taxes WHERE active = 1 ORDER BY is_default DESC, name ASC').all();
}

// Discounts Management
function createDiscountRule({
  code,
  name,
  discount_type,
  discount_value,
  min_purchase_amount = 0,
  min_quantity = 0,
  start_date,
  end_date,
  max_uses = 0,
  scope = 'subscription',
  product_id = null
}) {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const normalizedCode = code.trim().toUpperCase();

  const existing = db.prepare('SELECT id FROM discounts WHERE code = ?').get(normalizedCode);
  if (existing) throw new Error(`Discount code ${normalizedCode} already exists`);

  db.prepare(`
    INSERT INTO discounts (
      id, code, name, discount_type, discount_value, min_purchase_amount,
      min_quantity, start_date, end_date, max_uses, used_count, scope, product_id, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
  `).run(
    id, normalizedCode, name, discount_type, parseFloat(discount_value),
    parseFloat(min_purchase_amount || 0), parseInt(min_quantity || 0),
    start_date, end_date, parseInt(max_uses || 0), scope, product_id, now
  );

  return db.prepare('SELECT * FROM discounts WHERE id = ?').get(id);
}

function listDiscounts() {
  const db = getDatabase();
  return db.prepare(`
    SELECT d.*, p.name as product_name
    FROM discounts d
    LEFT JOIN products p ON d.product_id = p.id
    WHERE d.active = 1
    ORDER BY d.created_at DESC
  `).all();
}

function evaluateApplicableDiscounts(dateStr, totalAmount, totalQty, lineItems = []) {
  const db = getDatabase();
  const activeDiscounts = db.prepare(`
    SELECT * FROM discounts
    WHERE active = 1
      AND start_date <= ?
      AND end_date >= ?
      AND (max_uses = 0 OR used_count < max_uses)
  `).all(dateStr, dateStr);

  const appliedDiscounts = [];
  let totalDiscountAmount = 0;

  for (const disc of activeDiscounts) {
    if (disc.scope === 'subscription') {
      if (totalAmount >= disc.min_purchase_amount && totalQty >= disc.min_quantity) {
        let discAmount = 0;
        if (disc.discount_type === 'percentage') {
          discAmount = (totalAmount * disc.discount_value) / 100;
        } else {
          discAmount = Math.min(disc.discount_value, totalAmount);
        }
        if (discAmount > 0) {
          appliedDiscounts.push({
            discountId: disc.id,
            code: disc.code,
            name: disc.name,
            amount: discAmount,
            scope: 'subscription'
          });
          totalDiscountAmount += discAmount;
        }
      }
    } else if (disc.scope === 'product' && disc.product_id) {
      // Check lines for this product
      const matchingLines = lineItems.filter(l => l.product_id === disc.product_id && (l.active === undefined || l.active === 1));
      const lineQty = matchingLines.reduce((sum, l) => sum + (l.quantity || 1), 0);
      const lineSubtotal = matchingLines.reduce((sum, l) => sum + ((l.unit_price || 0) * (l.quantity || 1)), 0);

      if (lineSubtotal >= disc.min_purchase_amount && lineQty >= disc.min_quantity) {
        let discAmount = 0;
        if (disc.discount_type === 'percentage') {
          discAmount = (lineSubtotal * disc.discount_value) / 100;
        } else {
          discAmount = Math.min(disc.discount_value, lineSubtotal);
        }
        if (discAmount > 0) {
          appliedDiscounts.push({
            discountId: disc.id,
            code: disc.code,
            name: disc.name,
            amount: discAmount,
            scope: 'product',
            productId: disc.product_id
          });
          totalDiscountAmount += discAmount;
        }
      }
    }
  }

  return { appliedDiscounts, totalDiscountAmount };
}

// Generate Invoice for a Subscription
function generateInvoiceForSubscription(subscriptionId, billingDate = null, user = { name: 'Billing Engine' }) {
  const db = getDatabase();
  const sub = getSubscriptionById(subscriptionId);
  if (!sub) throw new Error('Subscription not found');

  if (sub.status !== 'Active') {
    throw new Error(`Cannot bill subscription in status: ${sub.status}`);
  }

  const billDate = billingDate || sub.next_billing_date || new Date().toISOString().split('T')[0];
  const nextPeriodEnd = calculateNextBillingDate(billDate, sub.billing_frequency);

  // Check idempotency: avoid double billing the exact same period
  const existingInvoice = db.prepare(`
    SELECT id, invoice_number FROM invoices
    WHERE subscription_id = ?
      AND billing_period_start = ?
      AND status != 'Cancelled'
  `).get(subscriptionId, billDate);

  if (existingInvoice) {
    throw new Error(`Billing period ${billDate} already billed on invoice ${existingInvoice.invoice_number}`);
  }

  // Active lines
  const activeLines = sub.lines.filter(l => l.active === 1);
  if (activeLines.length === 0) {
    throw new Error('Subscription has no active lines to bill');
  }

  // Fetch default tax rule if line has none
  const defaultTax = db.prepare('SELECT * FROM taxes WHERE is_default = 1 AND active = 1').get();

  let subtotal = 0;
  let totalQty = 0;
  const processedLines = [];

  for (const line of activeLines) {
    const qty = line.quantity;
    const unitPrice = line.unit_price;
    const lineSubtotal = qty * unitPrice;
    subtotal += lineSubtotal;
    totalQty += qty;

    // Tax calculation
    let taxRule = null;
    if (line.tax_id) {
      taxRule = db.prepare('SELECT * FROM taxes WHERE id = ?').get(line.tax_id);
    } else if (defaultTax) {
      taxRule = defaultTax;
    }

    const taxRate = taxRule ? taxRule.rate : 0;
    const taxName = taxRule ? taxRule.name : 'No Tax';
    const taxAmount = (lineSubtotal * taxRate) / 100;

    processedLines.push({
      product_id: line.product_id,
      variant_id: line.variant_id,
      description: line.description,
      quantity: qty,
      unit_price: unitPrice,
      tax_name: taxName,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      line_total: lineSubtotal + taxAmount
    });
  }

  // Evaluate Discounts
  const { appliedDiscounts, totalDiscountAmount } = evaluateApplicableDiscounts(billDate, subtotal, totalQty, activeLines);
  
  const totalTaxAmount = processedLines.reduce((sum, l) => sum + l.tax_amount, 0);
  const totalAmount = Math.max(0, subtotal + totalTaxAmount - totalDiscountAmount);
  const dueDate = calculateDueDate(billDate, sub.payment_terms);

  const invoiceId = crypto.randomUUID();
  const invoiceNumber = getNextInvoiceNumber();
  const now = new Date().toISOString();

  // Create Invoice
  db.prepare(`
    INSERT INTO invoices (
      id, invoice_number, subscription_id, customer_id, status,
      issue_date, due_date, subtotal, tax_total, discount_total,
      total_amount, amount_paid, balance_due, currency,
      billing_period_start, billing_period_end, notes, created_at
    ) VALUES (?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, 0, ?, 'USD', ?, ?, ?, ?)
  `).run(
    invoiceId, invoiceNumber, sub.id, sub.customer_id,
    billDate, dueDate, subtotal, totalTaxAmount, totalDiscountAmount,
    totalAmount, totalAmount, billDate, nextPeriodEnd,
    `Auto-generated from subscription ${sub.subscription_number}`, now
  );

  // Insert invoice lines
  for (const pl of processedLines) {
    db.prepare(`
      INSERT INTO invoice_lines (
        id, invoice_id, product_id, variant_id, description,
        quantity, unit_price, tax_name, tax_rate, tax_amount, discount_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      crypto.randomUUID(), invoiceId, pl.product_id, pl.variant_id, pl.description,
      pl.quantity, pl.unit_price, pl.tax_name, pl.tax_rate, pl.tax_amount, pl.line_total
    );
  }

  // Update discount usage counters
  for (const d of appliedDiscounts) {
    db.prepare(`UPDATE discounts SET used_count = used_count + 1 WHERE id = ?`).run(d.discountId);
  }

  // Advance subscription next billing date & update last billed date
  const nextBillingDate = calculateNextBillingDate(billDate, sub.billing_frequency);
  db.prepare(`
    UPDATE subscriptions
    SET last_billed_date = ?, next_billing_date = ?, updated_at = ?
    WHERE id = ?
  `).run(billDate, nextBillingDate, now, sub.id);

  // Audit log
  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, user.name, 'GENERATE_INVOICE', 'invoice', invoiceId,
    `Generated ${invoiceNumber} for ${sub.subscription_number} amount $${totalAmount.toFixed(2)}`
  );

  return getInvoiceById(invoiceId);
}

// Batch Billing Run (The Billing Day Scene)
function runBillingDay(targetDate = null, user = { name: 'Batch Billing Engine' }) {
  const db = getDatabase();
  const billingDate = targetDate || new Date().toISOString().split('T')[0];

  // Find all active subscriptions due on or before billingDate
  const dueSubscriptions = db.prepare(`
    SELECT id, subscription_number, next_billing_date
    FROM subscriptions
    WHERE status = 'Active'
      AND next_billing_date <= ?
    ORDER BY next_billing_date ASC
  `).all(billingDate);

  const results = {
    billingDate,
    totalSubscriptionsDue: dueSubscriptions.length,
    invoicesGenerated: [],
    skippedOrFailed: [],
    totalBilledAmount: 0
  };

  for (const sub of dueSubscriptions) {
    try {
      const inv = generateInvoiceForSubscription(sub.id, billingDate, user);
      results.invoicesGenerated.push({
        subscriptionId: sub.id,
        subscriptionNumber: sub.subscription_number,
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer_name,
        totalAmount: inv.total_amount
      });
      results.totalBilledAmount += inv.total_amount;
    } catch (err) {
      results.skippedOrFailed.push({
        subscriptionId: sub.id,
        subscriptionNumber: sub.subscription_number,
        error: err.message
      });
    }
  }

  return results;
}

function getInvoiceById(id) {
  const db = getDatabase();
  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name, c.email as customer_email, c.company_name, c.address as customer_address,
           s.subscription_number
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    LEFT JOIN subscriptions s ON i.subscription_id = s.id
    WHERE i.id = ?
  `).get(id);

  if (!invoice) return null;

  const lines = db.prepare(`
    SELECT il.*, p.name as product_name
    FROM invoice_lines il
    LEFT JOIN products p ON il.product_id = p.id
    WHERE il.invoice_id = ?
  `).all(id);

  const payments = db.prepare(`
    SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC
  `).all(id);

  const today = new Date().toISOString().split('T')[0];
  const isOverdue = invoice.status !== 'Paid' && invoice.status !== 'Cancelled' && invoice.due_date < today;

  return { ...invoice, lines, payments, is_overdue: isOverdue };
}

function listInvoices(filter = {}) {
  const db = getDatabase();
  let query = `
    SELECT i.*, c.name as customer_name, c.email as customer_email, c.company_name,
           s.subscription_number
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    LEFT JOIN subscriptions s ON i.subscription_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.customer_id) {
    query += ' AND i.customer_id = ?';
    params.push(filter.customer_id);
  }
  if (filter.status) {
    query += ' AND i.status = ?';
    params.push(filter.status);
  }
  if (filter.overdue_only) {
    const today = new Date().toISOString().split('T')[0];
    query += ` AND i.status NOT IN ('Paid', 'Cancelled') AND i.due_date < ?`;
    params.push(today);
  }
  if (filter.search) {
    query += ' AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.company_name LIKE ?)';
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY i.created_at DESC';

  const rows = db.prepare(query).all(...params);
  const today = new Date().toISOString().split('T')[0];

  return rows.map(r => ({
    ...r,
    is_overdue: r.status !== 'Paid' && r.status !== 'Cancelled' && r.due_date < today
  }));
}

function updateInvoiceStatus(id, newStatus, user = { name: 'Staff' }) {
  const db = getDatabase();
  const invoice = getInvoiceById(id);
  if (!invoice) throw new Error('Invoice not found');

  const validTransitions = {
    'Draft': ['Confirmed', 'Cancelled'],
    'Confirmed': ['Paid', 'Cancelled'],
    'Paid': [],
    'Cancelled': []
  };

  if (!validTransitions[invoice.status].includes(newStatus)) {
    throw new Error(`Cannot transition invoice from ${invoice.status} to ${newStatus}`);
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE invoices SET status = ? WHERE id = ?`).run(newStatus, id);

  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, user.name, 'UPDATE_INVOICE_STATUS', 'invoice', id,
    `Invoice ${invoice.invoice_number} marked as ${newStatus}`
  );

  return getInvoiceById(id);
}

function sendInvoice(id, user = { name: 'Staff' }) {
  const db = getDatabase();
  const invoice = getInvoiceById(id);
  if (!invoice) throw new Error('Invoice not found');

  const now = new Date().toISOString();
  db.prepare(`UPDATE invoices SET sent_at = ? WHERE id = ?`).run(now, id);

  // If was Draft, sending also confirms it
  if (invoice.status === 'Draft') {
    db.prepare(`UPDATE invoices SET status = 'Confirmed' WHERE id = ?`).run(id);
  }

  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, user.name, 'SEND_INVOICE', 'invoice', id,
    `Invoice ${invoice.invoice_number} sent to ${invoice.customer_email}`
  );

  return getInvoiceById(id);
}

module.exports = {
  getNextInvoiceNumber,
  calculateDueDate,
  createTaxRule,
  listTaxes,
  createDiscountRule,
  listDiscounts,
  evaluateApplicableDiscounts,
  generateInvoiceForSubscription,
  runBillingDay,
  getInvoiceById,
  listInvoices,
  updateInvoiceStatus,
  sendInvoice
};

