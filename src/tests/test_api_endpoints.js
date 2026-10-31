const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { handleApiRequest } = require('../routes/api');
const { seedDatabase } = require('../db/seed');

class MockRequest extends EventEmitter {
  constructor(method, url, headers = {}, body = null) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
  }
}

class MockResponse {
  constructor() {
    this.statusCode = null;
    this.headers = {};
    this.body = '';
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  end(data) {
    if (data) this.body += data;
  }

  getJson() {
    return this.body ? JSON.parse(this.body) : null;
  }
}

function callApi(method, path, body = {}, token = null) {
  return new Promise((resolve) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;

    const req = new MockRequest(method, path, headers, body);
    const res = new MockResponse();

    const parsedUrl = new URL(path, 'http://localhost:3000');
    handleApiRequest(req, res, parsedUrl, body);
    resolve(res);
  });
}

async function testAllApiEndpoints() {
  console.log('🧪 Testing all REST API endpoints via mock router...\n');
  seedDatabase();

  // 1. Login as Admin
  console.log('▶ API 1: Login & Authentication...');
  const loginRes = await callApi('POST', '/api/auth/login', {
    email: 'admin@brightloop.com',
    password: 'Brightloop@2026'
  });
  assert.strictEqual(loginRes.statusCode, 200);
  const authData = loginRes.getJson();
  assert.ok(authData.token);
  assert.strictEqual(authData.user.role, 'admin');
  const adminToken = authData.token;
  console.log('  ✔ POST /api/auth/login passed');

  // 2. Auth me endpoint
  const meRes = await callApi('GET', '/api/auth/me', {}, adminToken);
  assert.strictEqual(meRes.statusCode, 200);
  assert.strictEqual(meRes.getJson().user.email, 'admin@brightloop.com');
  console.log('  ✔ GET /api/auth/me passed');

  // 3. Staff Management (Admin only)
  console.log('▶ API 2: Staff Management...');
  const addStaffRes = await callApi('POST', '/api/staff', {
    name: 'Finance Analyst Dave',
    email: 'dave.finance@brightloop.com',
    password: 'StaffPassword123!',
    role: 'staff'
  }, adminToken);
  assert.strictEqual(addStaffRes.statusCode, 201);
  console.log('  ✔ POST /api/staff passed');

  const listStaffRes = await callApi('GET', '/api/staff', {}, adminToken);
  assert.strictEqual(listStaffRes.statusCode, 200);
  assert.ok(listStaffRes.getJson().length >= 3);
  console.log('  ✔ GET /api/staff passed');

  // 4. Products & Variants
  console.log('▶ API 3: Products & Variants...');
  const prodRes = await callApi('GET', '/api/products', {}, adminToken);
  assert.strictEqual(prodRes.statusCode, 200);
  const products = prodRes.getJson();
  assert.ok(products.length >= 2);
  const erpProd = products.find(p => p.name.includes('ERP'));
  assert.ok(erpProd.variants.length >= 2);
  console.log('  ✔ GET /api/products passed');

  // 5. Plans & Policies
  console.log('▶ API 4: Plans...');
  const plansRes = await callApi('GET', '/api/plans', {}, adminToken);
  assert.strictEqual(plansRes.statusCode, 200);
  assert.ok(plansRes.getJson().length >= 4);
  console.log('  ✔ GET /api/plans passed');

  // 6. Quotation Templates
  console.log('▶ API 5: Quotation Templates...');
  const tmplRes = await callApi('GET', '/api/quotation-templates', {}, adminToken);
  assert.strictEqual(tmplRes.statusCode, 200);
  assert.ok(tmplRes.getJson().length >= 2);
  console.log('  ✔ GET /api/quotation-templates passed');

  // 7. Subscriptions
  console.log('▶ API 6: Subscriptions...');
  const subsRes = await callApi('GET', '/api/subscriptions', {}, adminToken);
  assert.strictEqual(subsRes.statusCode, 200);
  const subs = subsRes.getJson();
  assert.ok(subs.length >= 4);
  console.log('  ✔ GET /api/subscriptions passed');

  // 8. Billing Day batch run
  console.log('▶ API 7: Batch Billing Day API...');
  const today = new Date().toISOString().split('T')[0];
  const billingRes = await callApi('POST', '/api/billing/run-day', { targetDate: today }, adminToken);
  assert.strictEqual(billingRes.statusCode, 200);
  const billingData = billingRes.getJson();
  assert.ok(billingData.invoicesGenerated.length > 0);
  console.log(`  ✔ POST /api/billing/run-day generated ${billingData.invoicesGenerated.length} invoices`);

  // 9. Invoices
  console.log('▶ API 8: Invoices...');
  const invRes = await callApi('GET', '/api/invoices', {}, adminToken);
  assert.strictEqual(invRes.statusCode, 200);
  const invoices = invRes.getJson();
  assert.ok(invoices.length > 0);

  const singleInvRes = await callApi('GET', `/api/invoices/${invoices[0].id}`, {}, adminToken);
  assert.strictEqual(singleInvRes.statusCode, 200);
  assert.ok(singleInvRes.getJson().lines.length > 0);
  console.log('  ✔ GET /api/invoices & /api/invoices/:id passed');

  // 10. Payments
  console.log('▶ API 9: Payments...');
  const openInv = invoices.find(i => i.balance_due > 0);
  if (openInv) {
    const payRes = await callApi('POST', '/api/payments', {
      invoice_id: openInv.id,
      payment_method: 'Credit Card',
      amount: Math.min(500, openInv.balance_due),
      payment_date: today,
      reference_note: 'API integration test charge'
    }, adminToken);
    assert.strictEqual(payRes.statusCode, 201);
    console.log('  ✔ POST /api/payments passed');
  }

  // 11. Overdue chase reminder
  console.log('▶ API 10: Overdue Chasing...');
  const overdueInv = invoices.find(i => i.is_overdue);
  if (overdueInv) {
    const chaseRes = await callApi('POST', `/api/invoices/${overdueInv.id}/chase`, {}, adminToken);
    assert.strictEqual(chaseRes.statusCode, 200);
    console.log('  ✔ POST /api/invoices/:id/chase passed');
  }

  // 12. Analytics Summary
  console.log('▶ API 11: Finance Lead Executive Analytics...');
  const summaryRes = await callApi('GET', '/api/analytics/summary', {}, adminToken);
  assert.strictEqual(summaryRes.statusCode, 200);
  const summary = summaryRes.getJson();
  assert.ok(summary.metrics.mrr > 0);
  assert.ok(summary.metrics.arr > 0);
  assert.strictEqual(summary.meta.performance_sla_met, true);
  console.log(`  ✔ GET /api/analytics/summary passed in ${summary.meta.execution_time_ms}ms`);

  console.log('\n===========================================');
  console.log('🎉 ALL REST API ENDPOINTS VERIFIED 100%!');
  console.log('===========================================\n');
}

testAllApiEndpoints().catch(err => {
  console.error('API Test Error:', err);
  process.exit(1);
});

