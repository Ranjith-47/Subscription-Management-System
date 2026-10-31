const assert = require('node:assert');
const { getDatabase } = require('../db/database');
const { seedDatabase } = require('../db/seed');
const {
  validatePassword,
  registerUser,
  loginUser,
  requestPasswordReset,
  resetPasswordWithToken
} = require('../services/authService');
const {
  createProduct,
  listProducts,
  createPlan,
  listPlans,
  createQuotationTemplate,
  listQuotationTemplates,
  createSubscription,
  getSubscriptionById,
  listSubscriptions,
  updateSubscriptionStatus,
  toggleSubscriptionAddon,
  autoCloseExpiredSubscriptions
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

async function runTests() {
  console.log('🚀 Starting Brightloop Subscription System Test Suite...\n');
  seedDatabase();

  // Test 1: Password Validation Rules
  console.log('▶ Test 1: Password complexity and account signup...');
  assert.strictEqual(validatePassword('short').valid, false, 'Should fail: too short');
  assert.strictEqual(validatePassword('nouppercase1!').valid, false, 'Should fail: no uppercase');
  assert.strictEqual(validatePassword('NOLOWERCASE1!').valid, false, 'Should fail: no lowercase');
  assert.strictEqual(validatePassword('NoSpecialChar123').valid, false, 'Should fail: no special character');
  assert.strictEqual(validatePassword('ValidPass123!').valid, true, 'Should pass: valid complexity');

  // Signup customer
  const custUser = registerUser({
    email: 'newcustomer@test.com',
    password: 'SecurePassword123!',
    name: 'New Tester Corp'
  });
  assert.strictEqual(custUser.role, 'customer');
  assert.ok(custUser.customerId, 'Should auto-create customer profile');

  // Unique email check
  let dupFailed = false;
  try {
    registerUser({ email: 'newcustomer@test.com', password: 'SecurePassword123!', name: 'Dup' });
  } catch (err) {
    dupFailed = true;
  }
  assert.ok(dupFailed, 'Should reject duplicate email registration');
  console.log('  ✔ Password rules and unique email verified');

  // Test 2: RBAC - Only Admin can add staff
  console.log('▶ Test 2: Staff creation authorization (RBAC)...');
  let nonAdminStaffCreationBlocked = false;
  try {
    registerUser({
      email: 'rogue@brightloop.com',
      password: 'StaffPassword123!',
      name: 'Rogue Staff',
      role: 'staff',
      creatorRole: 'customer' // Customer or staff cannot add staff
    });
  } catch (e) {
    nonAdminStaffCreationBlocked = true;
  }
  assert.ok(nonAdminStaffCreationBlocked, 'Should block non-admin from creating staff');

  const legitStaff = registerUser({
    email: 'support.lead@brightloop.com',
    password: 'StaffPassword123!',
    name: 'Emma Watson',
    role: 'staff',
    creatorRole: 'admin' // Admin allowed
  });
  assert.strictEqual(legitStaff.role, 'staff');
  console.log('  ✔ Only admin can add staff member verified');

  // Test 3: Password Reset Flow
  console.log('▶ Test 3: Password reset flow...');
  const resetReq = requestPasswordReset('newcustomer@test.com');
  assert.ok(resetReq.resetToken, 'Should produce reset token');
  const resetRes = resetPasswordWithToken(resetReq.resetToken, 'BrandNewPassword999#');
  assert.strictEqual(resetRes.success, true);
  const loginAfterReset = loginUser('newcustomer@test.com', 'BrandNewPassword999#');
  assert.ok(loginAfterReset.token, 'Should successfully log in with reset password');
  console.log('  ✔ Password reset flow verified');

  // Test 4: Launching a product with variants (Odoo brand adds 560)
  console.log('▶ Test 4: Product & Variants creation...');
  const prod = createProduct({
    name: 'Cloud Infrastructure Engine',
    type: 'software',
    sales_price: 1000,
    cost_price: 250,
    notes: 'Engine tier',
    variants: [
      { attribute_name: 'Brand', option_name: 'Odoo Edition', price_adjustment: 560 },
      { attribute_name: 'Brand', option_name: 'Standard Edition', price_adjustment: 0 }
    ]
  });
  assert.strictEqual(prod.name, 'Cloud Infrastructure Engine');
  assert.strictEqual(prod.variants.length, 2);
  const odooVar = prod.variants.find(v => v.option_name === 'Odoo Edition');
  assert.strictEqual(odooVar.price_adjustment, 560, 'Odoo variant must add 560');
  console.log('  ✔ Product variants and pricing adjustments verified');

  // Test 5: Plan creation with lifecycle policies
  console.log('▶ Test 5: Plan policies (billing frequency, auto-close, pause, renewal)...');
  const plan = createPlan({
    name: 'Quarterly Dedicated Plan',
    product_id: prod.id,
    base_cost: 3000,
    billing_frequency: 'monthly',
    min_quantity: 2,
    valid_from: '2026-01-01',
    valid_to: '2028-01-01',
    auto_close_on_expiry: 1,
    allow_early_close: 0,
    allow_pause: 1,
    allow_renewal: 1
  });
  assert.strictEqual(plan.billing_frequency, 'monthly');
  assert.strictEqual(plan.auto_close_on_expiry, 1);
  assert.strictEqual(plan.allow_early_close, 0);
  console.log('  ✔ Plan policies verified');

  // Test 6: Quotation Template & Turning Quote into Subscription
  console.log('▶ Test 6: Quotation template and turning quote into active subscription...');
  const tmpl = createQuotationTemplate({
    name: 'Custom Cloud Quote Template',
    plan_id: plan.id,
    validity_days: 15,
    lines: [
      { product_id: prod.id, variant_id: odooVar.id, quantity: 2, description: 'Cloud Engine (Odoo Edition)' }
    ]
  });
  assert.ok(tmpl.id);

  // Create subscription from template lines
  const sub = createSubscription({
    customer_id: custUser.customerId,
    plan_id: plan.id,
    payment_terms: 'Net 15',
    notes: 'Generated from quote template',
    lines: tmpl.lines
  });

  assert.strictEqual(sub.status, 'Draft');
  assert.strictEqual(sub.lines.length, 1);
  // Unit price = 1000 base + 560 variant = 1560 * 2 = 3120
  assert.strictEqual(sub.lines[0].unit_price, 1560);
  assert.strictEqual(sub.lines[0].line_total, 3120);

  // State machine transitions: Draft -> Quotation -> Confirmed -> Active
  const subQuotation = updateSubscriptionStatus(sub.id, 'Quotation');
  assert.strictEqual(subQuotation.status, 'Quotation');

  const subConfirmed = updateSubscriptionStatus(sub.id, 'Confirmed');
  assert.strictEqual(subConfirmed.status, 'Confirmed');

  const subActive = updateSubscriptionStatus(sub.id, 'Active');
  assert.strictEqual(subActive.status, 'Active');

  // Pausing should work because allow_pause = 1
  const subPaused = updateSubscriptionStatus(sub.id, 'Paused');
  assert.strictEqual(subPaused.status, 'Paused');

  const subResumed = updateSubscriptionStatus(sub.id, 'Active');
  assert.strictEqual(subResumed.status, 'Active');

  // Early close should be blocked because allow_early_close = 0
  let earlyCloseBlocked = false;
  try {
    updateSubscriptionStatus(sub.id, 'Closed');
  } catch (err) {
    earlyCloseBlocked = true;
  }
  assert.ok(earlyCloseBlocked, 'Early close should be blocked when plan disallows it');
  console.log('  ✔ Subscription state machine & policies verified');

  // Test 7: Add-on toggle (Customer self-service scene)
  console.log('▶ Test 7: Add-on switching on/off...');
  // Add an add-on product line
  const addonProduct = createProduct({
    name: 'Managed Security Add-on',
    type: 'addon',
    sales_price: 300,
    cost_price: 50
  });
  const { addLineToSubscription } = require('../services/subscriptionService');
  const addonLineId = addLineToSubscription(sub.id, {
    product_id: addonProduct.id,
    quantity: 1,
    is_addon: 1,
    active: 0 // initially off
  });

  let subUpdated = getSubscriptionById(sub.id);
  assert.strictEqual(subUpdated.recurring_total, 3120, 'Add-on is inactive so recurring total unchanged');

  // Customer turns add-on ON
  subUpdated = toggleSubscriptionAddon(sub.id, addonLineId, true, { name: 'Customer Self-Service' });
  assert.strictEqual(subUpdated.recurring_total, 3420, 'Recurring total updated (+300)');

  // Customer turns add-on OFF
  subUpdated = toggleSubscriptionAddon(sub.id, addonLineId, false, { name: 'Customer Self-Service' });
  assert.strictEqual(subUpdated.recurring_total, 3120, 'Recurring total decremented back');
  console.log('  ✔ Customer self-service add-on toggle verified');

  // Test 8: Discount Rules & Auto-Application on Billing Day
  console.log('▶ Test 8: Admin discounts & Billing Day batch run...');
  const disc = createDiscountRule({
    code: 'BULKDEAL300',
    name: '$300 Volume Rebate',
    discount_type: 'fixed',
    discount_value: 300,
    min_purchase_amount: 1500,
    min_quantity: 2,
    start_date: '2026-01-01',
    end_date: '2027-12-31',
    max_uses: 10,
    scope: 'subscription'
  });
  assert.strictEqual(disc.code, 'BULKDEAL300');

  // Run billing day
  const today = new Date().toISOString().split('T')[0];
  const billingResult = runBillingDay(today, { name: 'Automated Billing Test' });
  assert.ok(billingResult.invoicesGenerated.length > 0, 'Should generate invoices for due subscriptions');

  // Check generated invoice for our subscription
  const generatedInv = billingResult.invoicesGenerated.find(i => i.subscriptionId === sub.id);
  assert.ok(generatedInv, 'Our active subscription must be billed on billing day');

  const invDetails = getInvoiceById(generatedInv.invoiceId);
  assert.strictEqual(invDetails.subtotal, 3120);
  // Total discounts applied: $300 BULKDEAL300 + $50 WELCOME50 = $350
  assert.strictEqual(invDetails.discount_total, 350, 'Discounts should be auto-applied');
  // Subtotal 3120 + 20% VAT (624) - 350 = 3394
  assert.strictEqual(invDetails.total_amount, 3394);
  assert.strictEqual(invDetails.balance_due, 3394);

  // Verify next billing date moved forward
  const subAfterBilling = getSubscriptionById(sub.id);
  assert.notStrictEqual(subAfterBilling.next_billing_date, today, 'Next billing date must advance');

  // Verify idempotency: running billing day again should not bill twice!
  const secondBilling = runBillingDay(today);
  const reBilled = secondBilling.invoicesGenerated.find(i => i.subscriptionId === sub.id);
  assert.strictEqual(reBilled, undefined, 'Must NEVER bill the same subscription twice for same period');
  console.log('  ✔ Billing Day & discount calculation & idempotency verified');

  // Test 9: Payment recording & Invoice settlement
  console.log('▶ Test 9: Recording payments (partial & full settlement)...');
  // Partial payment of $1000
  const partialPay = recordPayment({
    invoice_id: invDetails.id,
    payment_method: 'Bank Transfer',
    amount: 1000,
    reference_note: 'Wire reference WT-99001',
    recorded_by: 'Mark (Staff)'
  });
  assert.strictEqual(partialPay.invoice.amount_paid, 1000);
  assert.strictEqual(partialPay.invoice.balance_due, 2394);

  // Remaining payment of $2394
  const fullPay = recordPayment({
    invoice_id: invDetails.id,
    payment_method: 'Stripe',
    amount: 2394,
    reference_note: 'Card charge ch_882910',
    recorded_by: 'Customer Portal'
  });
  assert.strictEqual(fullPay.invoice.amount_paid, 3394);
  assert.strictEqual(fullPay.invoice.balance_due, 0);
  assert.strictEqual(fullPay.invoice.status, 'Paid', 'Status must automatically become Paid when balance reaches 0');
  console.log('  ✔ Payment recording and real-time settlement verified');

  // Test 10: Overdue Invoices & Chasing
  console.log('▶ Test 10: Overdue detection and chasing...');
  const overdueInvoices = listInvoices({ overdue_only: true });
  assert.ok(overdueInvoices.length > 0, 'Seed overdue invoice should be detected');
  const chaseResult = chaseOverdueInvoice(overdueInvoices[0].id, { name: 'Finance Lead' });
  assert.strictEqual(chaseResult.success, true);
  console.log('  ✔ Overdue detection and reminder chasing verified');

  // Test 11: Finance Lead Dashboard & Performance SLA (< 2s)
  console.log('▶ Test 11: Finance Lead analytics & Performance (< 2 seconds)...');
  const summary = getFinanceSummary();
  assert.ok(summary.metrics.active_subscriptions > 0, 'Active subscriptions count');
  assert.ok(summary.metrics.mrr > 0, 'MRR computed');
  assert.ok(summary.metrics.arr > 0, 'ARR computed');
  assert.ok(summary.metrics.total_revenue_collected > 0, 'Total revenue collected');
  assert.ok(summary.metrics.total_outstanding_owed > 0, 'Total revenue still owed');
  assert.ok(summary.metrics.overdue_count > 0, 'Overdue count');
  assert.strictEqual(summary.meta.performance_sla_met, true, 'Performance must be < 2000ms');
  console.log(`  ✔ Analytics computed in ${summary.meta.execution_time_ms}ms (Target: < 2000ms, Met: ${summary.meta.performance_sla_met})`);

  console.log('\n===========================================');
  console.log('🎉 ALL 11 TESTS PASSED WITH 100% SUCCESS!');
  console.log('===========================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
