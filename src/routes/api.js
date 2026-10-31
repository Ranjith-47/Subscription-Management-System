const { getDatabase } = require('../db/database');
const {
  registerUser,
  loginUser,
  verifySession,
  requestPasswordReset,
  resetPasswordWithToken
} = require('../services/authService');
const {
  createProduct,
  listProducts,
  getProductById,
  createPlan,
  listPlans,
  createQuotationTemplate,
  listQuotationTemplates,
  getQuotationTemplateById,
  createSubscription,
  getSubscriptionById,
  listSubscriptions,
  updateSubscriptionStatus,
  toggleSubscriptionAddon
} = require('../services/subscriptionService');
const {
  createTaxRule,
  listTaxes,
  createDiscountRule,
  listDiscounts,
  runBillingDay,
  generateInvoiceForSubscription,
  getInvoiceById,
  listInvoices,
  updateInvoiceStatus,
  sendInvoice
} = require('../services/billingEngine');
const {
  recordPayment,
  listPayments,
  chaseOverdueInvoice
} = require('../services/paymentService');
const {
  getFinanceSummary,
  getAuditLogs
} = require('../services/analyticsService');
const { seedDatabase } = require('../db/seed');

function parseAuth(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return verifySession(parts[1]);
  }
  return null;
}

function handleApiRequest(req, res, url, body) {
  const pathname = url.pathname;
  const method = req.method.toUpperCase();
  const session = parseAuth(req);

  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(data));
  };

  const sendError = (statusCode, message) => {
    sendJson(statusCode, { error: message });
  };

  try {
    // 1. Auth routes
    if (pathname === '/api/auth/register' && method === 'POST') {
      const user = registerUser({
        ...body,
        creatorRole: session ? session.role : null
      });
      return sendJson(201, { user });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const result = loginUser(body.email, body.password);
      return sendJson(200, result);
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!session) return sendError(401, 'Unauthorized');
      return sendJson(200, { user: session });
    }

    if (pathname === '/api/auth/forgot-password' && method === 'POST') {
      const result = requestPasswordReset(body.email);
      return sendJson(200, result);
    }

    if (pathname === '/api/auth/reset-password' && method === 'POST') {
      const result = resetPasswordWithToken(body.token, body.newPassword);
      return sendJson(200, result);
    }

    // 2. Staff Management (Admin only)
    if (pathname === '/api/staff' && method === 'GET') {
      if (!session || session.role !== 'admin') return sendError(403, 'Forbidden: Admin access required');
      const db = getDatabase();
      const staffList = db.prepare(`SELECT id, email, name, role, created_at FROM users WHERE role IN ('admin', 'staff') ORDER BY created_at DESC`).all();
      return sendJson(200, staffList);
    }

    if (pathname === '/api/staff' && method === 'POST') {
      if (!session || session.role !== 'admin') return sendError(403, 'Forbidden: Admin access required');
      const user = registerUser({
        email: body.email,
        password: body.password,
        name: body.name,
        role: body.role || 'staff',
        creatorRole: 'admin'
      });
      return sendJson(201, { user });
    }

    // 3. Customers
    if (pathname === '/api/customers' && method === 'GET') {
      const db = getDatabase();
      let customers;
      if (session && session.role === 'customer') {
        customers = db.prepare('SELECT * FROM customers WHERE id = ?').all(session.customerId);
      } else {
        customers = db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
      }
      return sendJson(200, customers);
    }

    if (pathname === '/api/customers' && method === 'POST') {
      const db = getDatabase();
      const crypto = require('node:crypto');
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO customers (id, name, email, company_name, phone, address, currency, payment_terms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, body.name, body.email, body.company_name || body.name,
        body.phone || '', body.address || '', body.currency || 'USD',
        body.payment_terms || 'Net 30', now
      );
      const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      return sendJson(201, created);
    }

    // 4. Products & Variants
    if (pathname === '/api/products' && method === 'GET') {
      return sendJson(200, listProducts());
    }

    if (pathname === '/api/products' && method === 'POST') {
      if (!session || session.role !== 'admin') return sendError(403, 'Admin privilege required');
      const product = createProduct(body);
      return sendJson(201, product);
    }

    // 5. Plans
    if (pathname === '/api/plans' && method === 'GET') {
      return sendJson(200, listPlans());
    }

    if (pathname === '/api/plans' && method === 'POST') {
      if (!session || session.role !== 'admin') return sendError(403, 'Admin privilege required');
      const plan = createPlan(body);
      return sendJson(201, plan);
    }

    // 6. Quotation Templates
    if (pathname === '/api/quotation-templates' && method === 'GET') {
      return sendJson(200, listQuotationTemplates());
    }

    if (pathname === '/api/quotation-templates' && method === 'POST') {
      const tmpl = createQuotationTemplate(body);
      return sendJson(201, tmpl);
    }

    // 7. Subscriptions
    if (pathname === '/api/subscriptions' && method === 'GET') {
      const filter = {};
      if (session && session.role === 'customer') {
        filter.customer_id = session.customerId;
      } else if (url.searchParams.get('customer_id')) {
        filter.customer_id = url.searchParams.get('customer_id');
      }
      if (url.searchParams.get('status')) filter.status = url.searchParams.get('status');
      if (url.searchParams.get('plan_id')) filter.plan_id = url.searchParams.get('plan_id');
      if (url.searchParams.get('search')) filter.search = url.searchParams.get('search');

      return sendJson(200, listSubscriptions(filter));
    }

    if (pathname === '/api/subscriptions' && method === 'POST') {
      const sub = createSubscription(body);
      return sendJson(201, sub);
    }

    if (pathname.startsWith('/api/subscriptions/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const sub = getSubscriptionById(id);
      if (!sub) return sendError(404, 'Subscription not found');
      if (session && session.role === 'customer' && sub.customer_id !== session.customerId) {
        return sendError(403, 'Access denied to this subscription');
      }
      return sendJson(200, sub);
    }

    if (pathname.match(/^\/api\/subscriptions\/[^\/]+\/status$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const updated = updateSubscriptionStatus(id, body.status, session || { name: 'Staff' });
      return sendJson(200, updated);
    }

    if (pathname.match(/^\/api\/subscriptions\/[^\/]+\/toggle-addon$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const updated = toggleSubscriptionAddon(id, body.line_id, body.active, session || { name: 'Customer' });
      return sendJson(200, updated);
    }

    // 8. Billing Day & Invoices
    if (pathname === '/api/billing/run-day' && method === 'POST') {
      const result = runBillingDay(body.targetDate, session || { name: 'Billing Lead' });
      return sendJson(200, result);
    }

    if (pathname === '/api/billing/generate-invoice' && method === 'POST') {
      const invoice = generateInvoiceForSubscription(body.subscription_id, body.billingDate, session || { name: 'Staff' });
      return sendJson(201, invoice);
    }

    if (pathname === '/api/invoices' && method === 'GET') {
      const filter = {};
      if (session && session.role === 'customer') {
        filter.customer_id = session.customerId;
      } else if (url.searchParams.get('customer_id')) {
        filter.customer_id = url.searchParams.get('customer_id');
      }
      if (url.searchParams.get('status')) filter.status = url.searchParams.get('status');
      if (url.searchParams.get('overdue_only')) filter.overdue_only = true;
      if (url.searchParams.get('search')) filter.search = url.searchParams.get('search');

      return sendJson(200, listInvoices(filter));
    }

    if (pathname.startsWith('/api/invoices/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const invoice = getInvoiceById(id);
      if (!invoice) return sendError(404, 'Invoice not found');
      if (session && session.role === 'customer' && invoice.customer_id !== session.customerId) {
        return sendError(403, 'Access denied to this invoice');
      }
      return sendJson(200, invoice);
    }

    if (pathname.match(/^\/api\/invoices\/[^\/]+\/status$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const updated = updateInvoiceStatus(id, body.status, session || { name: 'Staff' });
      return sendJson(200, updated);
    }

    if (pathname.match(/^\/api\/invoices\/[^\/]+\/send$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const updated = sendInvoice(id, session || { name: 'Staff' });
      return sendJson(200, updated);
    }

    if (pathname.match(/^\/api\/invoices\/[^\/]+\/chase$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const chased = chaseOverdueInvoice(id, session || { name: 'Finance Lead' });
      return sendJson(200, chased);
    }

    // 9. Taxes & Discounts
    if (pathname === '/api/taxes' && method === 'GET') {
      return sendJson(200, listTaxes());
    }

    if (pathname === '/api/taxes' && method === 'POST') {
      if (!session || session.role !== 'admin') return sendError(403, 'Admin privilege required');
      const tax = createTaxRule(body);
      return sendJson(201, tax);
    }

    if (pathname === '/api/discounts' && method === 'GET') {
      return sendJson(200, listDiscounts());
    }

    if (pathname === '/api/discounts' && method === 'POST') {
      if (!session || session.role !== 'admin') return sendError(403, 'Admin privilege required: only admin can create discount rules');
      const disc = createDiscountRule(body);
      return sendJson(201, disc);
    }

    // 10. Payments
    if (pathname === '/api/payments' && method === 'GET') {
      const invoiceId = url.searchParams.get('invoice_id');
      return sendJson(200, listPayments(invoiceId));
    }

    if (pathname === '/api/payments' && method === 'POST') {
      const result = recordPayment({
        ...body,
        recorded_by: session ? session.name : 'System'
      });
      return sendJson(201, result);
    }

    // 11. Analytics & Finance Reports
    if (pathname === '/api/analytics/summary' && method === 'GET') {
      const filters = {
        plan_id: url.searchParams.get('plan_id'),
        customer_id: url.searchParams.get('customer_id'),
        start_date: url.searchParams.get('start_date'),
        end_date: url.searchParams.get('end_date')
      };
      return sendJson(200, getFinanceSummary(filters));
    }

    if (pathname === '/api/analytics/audit-logs' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return sendJson(200, getAuditLogs(limit));
    }

    // 12. Re-seed system endpoint
    if (pathname === '/api/system/seed' && method === 'POST') {
      seedDatabase();
      return sendJson(200, { success: true, message: 'Database reset and seeded with default Brightloop scenarios.' });
    }

    return sendError(404, `Endpoint not found: ${method} ${pathname}`);
  } catch (err) {
    console.error('API Error:', err);
    return sendError(400, err.message || 'Internal server error');
  }
}

module.exports = { handleApiRequest };

