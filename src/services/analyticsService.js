const { getDatabase } = require('../db/database');

function getFinanceSummary(filters = {}) {
  const startTime = Date.now();
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  // 1. Active Subscriptions & MRR / ARR calculation
  let subQuery = `
    SELECT s.id, s.status, s.next_billing_date, p.billing_frequency, p.name as plan_name,
           (SELECT COALESCE(SUM(sl.line_total), 0) FROM subscription_lines sl WHERE sl.subscription_id = s.id AND sl.active = 1) as sub_total
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE 1=1
  `;
  const subParams = [];
  if (filters.plan_id) {
    subQuery += ' AND s.plan_id = ?';
    subParams.push(filters.plan_id);
  }
  if (filters.customer_id) {
    subQuery += ' AND s.customer_id = ?';
    subParams.push(filters.customer_id);
  }

  const allSubs = db.prepare(subQuery).all(...subParams);

  let activeCount = 0;
  let pausedCount = 0;
  let closedCount = 0;
  let draftCount = 0;
  let quotationCount = 0;
  let confirmedCount = 0;
  let monthlyRecurringRevenue = 0;

  for (const s of allSubs) {
    if (s.status === 'Active') {
      activeCount++;
      const val = parseFloat(s.sub_total || 0);
      switch (s.billing_frequency) {
        case 'daily':
          monthlyRecurringRevenue += val * 30;
          break;
        case 'weekly':
          monthlyRecurringRevenue += val * 4.33;
          break;
        case 'yearly':
          monthlyRecurringRevenue += val / 12;
          break;
        case 'monthly':
        default:
          monthlyRecurringRevenue += val;
          break;
      }
    } else if (s.status === 'Paused') {
      pausedCount++;
    } else if (s.status === 'Closed') {
      closedCount++;
    } else if (s.status === 'Draft') {
      draftCount++;
    } else if (s.status === 'Quotation') {
      quotationCount++;
    } else if (s.status === 'Confirmed') {
      confirmedCount++;
    }
  }

  const annualRecurringRevenue = monthlyRecurringRevenue * 12;

  // 2. Invoices & Revenue Collected vs Still Owed
  let invQuery = `
    SELECT id, invoice_number, status, issue_date, due_date, total_amount, amount_paid, balance_due
    FROM invoices
    WHERE status != 'Cancelled'
  `;
  const invParams = [];
  if (filters.customer_id) {
    invQuery += ' AND customer_id = ?';
    invParams.push(filters.customer_id);
  }
  if (filters.start_date) {
    invQuery += ' AND issue_date >= ?';
    invParams.push(filters.start_date);
  }
  if (filters.end_date) {
    invQuery += ' AND issue_date <= ?';
    invParams.push(filters.end_date);
  }

  const invoices = db.prepare(invQuery).all(...invParams);

  let totalRevenueCollected = 0;
  let totalOutstandingOwed = 0;
  let overdueCount = 0;
  let totalOverdueAmount = 0;

  const agingBuckets = {
    '1-30 days': { count: 0, amount: 0 },
    '31-60 days': { count: 0, amount: 0 },
    '61-90 days': { count: 0, amount: 0 },
    '90+ days': { count: 0, amount: 0 }
  };

  const overdueInvoicesList = [];

  for (const inv of invoices) {
    totalRevenueCollected += inv.amount_paid;
    if (inv.status !== 'Paid') {
      totalOutstandingOwed += inv.balance_due;

      if (inv.due_date < today) {
        overdueCount++;
        totalOverdueAmount += inv.balance_due;

        const dueDate = new Date(inv.due_date);
        const currentDate = new Date(today);
        const diffDays = Math.floor((currentDate - dueDate) / (1000 * 60 * 60 * 24));

        let bucket = '1-30 days';
        if (diffDays > 90) bucket = '90+ days';
        else if (diffDays > 60) bucket = '61-90 days';
        else if (diffDays > 30) bucket = '31-60 days';

        agingBuckets[bucket].count++;
        agingBuckets[bucket].amount += inv.balance_due;

        overdueInvoicesList.push({
          id: inv.id,
          invoice_number: inv.invoice_number,
          due_date: inv.due_date,
          days_overdue: diffDays,
          balance_due: inv.balance_due,
          aging_bucket: bucket
        });
      }
    }
  }

  // 3. Plan distribution breakdown
  const planBreakdown = db.prepare(`
    SELECT p.name as plan_name, p.billing_frequency, COUNT(s.id) as subscriber_count
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.status = 'Active'
    GROUP BY p.id
    ORDER BY subscriber_count DESC
  `).all();

  const queryTimeMs = Date.now() - startTime;

  return {
    meta: {
      generated_at: new Date().toISOString(),
      execution_time_ms: queryTimeMs,
      performance_sla_met: queryTimeMs < 2000 // Verified < 2 seconds
    },
    metrics: {
      active_subscriptions: activeCount,
      total_subscriptions: allSubs.length,
      paused_subscriptions: pausedCount,
      closed_subscriptions: closedCount,
      quotations_pending: quotationCount,
      confirmed_subscriptions: confirmedCount,
      mrr: Math.round(monthlyRecurringRevenue * 100) / 100,
      arr: Math.round(annualRecurringRevenue * 100) / 100,
      total_revenue_collected: Math.round(totalRevenueCollected * 100) / 100,
      total_outstanding_owed: Math.round(totalOutstandingOwed * 100) / 100,
      overdue_count: overdueCount,
      total_overdue_amount: Math.round(totalOverdueAmount * 100) / 100
    },
    aging_buckets: agingBuckets,
    overdue_invoices: overdueInvoicesList.sort((a, b) => b.days_overdue - a.days_overdue),
    plan_distribution: planBreakdown
  };
}

function getAuditLogs(limit = 50) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  getFinanceSummary,
  getAuditLogs
};

