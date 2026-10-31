const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { getInvoiceById } = require('./billingEngine');

function getNextPaymentNumber() {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const prefix = `PAY-${year}-`;
  
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM payments WHERE payment_number LIKE ?
  `).get(`${prefix}%`);

  const nextSeq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

function recordPayment({
  invoice_id,
  payment_method,
  amount,
  payment_date = null,
  reference_note = '',
  recorded_by = 'Staff'
}) {
  const db = getDatabase();
  const invoice = getInvoiceById(invoice_id);
  if (!invoice) throw new Error('Invoice not found');

  if (invoice.status === 'Paid') {
    throw new Error('This invoice is already fully paid');
  }
  if (invoice.status === 'Cancelled') {
    throw new Error('Cannot record payment for a cancelled invoice');
  }

  const paymentAmount = parseFloat(amount);
  if (isNaN(paymentAmount) || paymentAmount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  if (paymentAmount > (invoice.balance_due + 0.001)) {
    throw new Error(`Payment amount ($${paymentAmount.toFixed(2)}) exceeds balance due ($${invoice.balance_due.toFixed(2)})`);
  }

  const paymentId = crypto.randomUUID();
  const paymentNumber = getNextPaymentNumber();
  const dateStr = payment_date || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  // Insert payment
  db.prepare(`
    INSERT INTO payments (
      id, invoice_id, payment_number, payment_method, amount, payment_date, reference_note, recorded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    paymentId, invoice_id, paymentNumber, payment_method, paymentAmount, dateStr, reference_note, recorded_by, now
  );

  // Update invoice amount_paid and balance_due
  const newAmountPaid = invoice.amount_paid + paymentAmount;
  const newBalanceDue = Math.max(0, invoice.total_amount - newAmountPaid);
  const isFullyPaid = newBalanceDue <= 0.009; // Float safety threshold

  const newStatus = isFullyPaid ? 'Paid' : invoice.status;

  db.prepare(`
    UPDATE invoices
    SET amount_paid = ?, balance_due = ?, status = ?
    WHERE id = ?
  `).run(newAmountPaid, newBalanceDue, newStatus, invoice_id);

  // If invoice was Draft and payment made, status becomes Paid or Confirmed
  if (invoice.status === 'Draft' && !isFullyPaid) {
    db.prepare(`UPDATE invoices SET status = 'Confirmed' WHERE id = ?`).run(invoice_id);
  }

  // Audit log
  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, recorded_by, 'RECORD_PAYMENT', 'payment', paymentId,
    `Payment ${paymentNumber} of $${paymentAmount.toFixed(2)} recorded for Invoice ${invoice.invoice_number} via ${payment_method}`
  );

  return {
    payment: {
      id: paymentId,
      payment_number: paymentNumber,
      amount: paymentAmount,
      payment_method,
      payment_date: dateStr,
      reference_note
    },
    invoice: getInvoiceById(invoice_id)
  };
}

function listPayments(invoiceId = null) {
  const db = getDatabase();
  let query = `
    SELECT p.*, i.invoice_number, i.customer_id, c.name as customer_name, c.company_name
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    JOIN customers c ON i.customer_id = c.id
  `;
  const params = [];

  if (invoiceId) {
    query += ' WHERE p.invoice_id = ?';
    params.push(invoiceId);
  }

  query += ' ORDER BY p.payment_date DESC, p.created_at DESC';
  return db.prepare(query).all(...params);
}

function chaseOverdueInvoice(invoiceId, user = { name: 'Staff' }) {
  const db = getDatabase();
  const invoice = getInvoiceById(invoiceId);
  if (!invoice) throw new Error('Invoice not found');

  const today = new Date().toISOString().split('T')[0];
  if (invoice.status === 'Paid' || invoice.due_date >= today) {
    throw new Error('Invoice is not overdue');
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), now, user.name, 'CHASE_OVERDUE', 'invoice', invoiceId,
    `Overdue reminder chased for ${invoice.invoice_number} to ${invoice.customer_email} (Amount due: $${invoice.balance_due.toFixed(2)})`
  );

  return {
    success: true,
    message: `Reminder sent to ${invoice.customer_email} for overdue invoice ${invoice.invoice_number}`,
    invoice
  };
}

module.exports = {
  getNextPaymentNumber,
  recordPayment,
  listPayments,
  chaseOverdueInvoice
};

