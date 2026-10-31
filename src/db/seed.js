const crypto = require('node:crypto');
const { getDatabase } = require('./database');
const { hashPassword } = require('../services/authService');
const { calculateNextBillingDate } = require('../services/subscriptionService');
const { calculateDueDate } = require('../services/billingEngine');

function seedDatabase() {
  const db = getDatabase();

  // Clear existing data for fresh clean state
  db.exec(`
    DELETE FROM audit_logs;
    DELETE FROM payments;
    DELETE FROM invoice_lines;
    DELETE FROM invoices;
    DELETE FROM subscription_lines;
    DELETE FROM subscriptions;
    DELETE FROM quotation_templates;
    DELETE FROM discounts;
    DELETE FROM taxes;
    DELETE FROM plans;
    DELETE FROM product_variants;
    DELETE FROM products;
    DELETE FROM password_resets;
    DELETE FROM users;
    DELETE FROM customers;
  `);

  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // 1. Seed Taxes
  const taxVatId = crypto.randomUUID();
  const taxUsId = crypto.randomUUID();
  const taxZeroId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO taxes (id, name, rate, description, is_default, active, created_at)
    VALUES (?, 'Standard VAT (20%)', 20.0, 'Standard Value Added Tax across EU/UK', 1, 1, ?)
  `).run(taxVatId, now);

  db.prepare(`
    INSERT INTO taxes (id, name, rate, description, is_default, active, created_at)
    VALUES (?, 'US State Sales Tax (8.5%)', 8.5, 'Standard US regional sales tax', 0, 1, ?)
  `).run(taxUsId, now);

  db.prepare(`
    INSERT INTO taxes (id, name, rate, description, is_default, active, created_at)
    VALUES (?, 'Zero Rated (0%)', 0.0, 'International B2B reverse charge or tax exempt', 0, 1, ?)
  `).run(taxZeroId, now);

  // 2. Seed Customers
  const custAcmeId = crypto.randomUUID();
  const custNexusId = crypto.randomUUID();
  const custCloudId = crypto.randomUUID();
  const custVertexId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO customers (id, name, email, company_name, phone, address, currency, payment_terms, created_at)
    VALUES (?, 'Alice Miller', 'alice@acmeshop.com', 'Acme Retail & Co.', '+1-555-0120', '742 Evergreen Terrace, Springfield', 'USD', 'Net 15', ?)
  `).run(custAcmeId, now);

  db.prepare(`
    INSERT INTO customers (id, name, email, company_name, phone, address, currency, payment_terms, created_at)
    VALUES (?, 'David Sterling', 'dave@nexusglobal.com', 'Nexus Enterprise Holdings', '+1-555-0199', '100 Wall Street, New York, NY', 'USD', 'Net 30', ?)
  `).run(custNexusId, now);

  db.prepare(`
    INSERT INTO customers (id, name, email, company_name, phone, address, currency, payment_terms, created_at)
    VALUES (?, 'Elena Rostova', 'ops@cloudscale.io', 'CloudScale Dynamics', '+44-20-7946-0991', '10 Finsbury Square, London, UK', 'USD', 'Net 15', ?)
  `).run(custCloudId, now);

  db.prepare(`
    INSERT INTO customers (id, name, email, company_name, phone, address, currency, payment_terms, created_at)
    VALUES (?, 'Marcus Thorne', 'marcus@vertexlabs.tech', 'Vertex Labs AI', '+1-555-0184', '500 Technology Square, Cambridge, MA', 'USD', 'Due on Receipt', ?)
  `).run(custVertexId, now);

  // 3. Seed Users (Admin, Staff, Customers)
  // Password rule: > 8 chars, uppercase, lowercase, special character
  const adminPass = hashPassword('Brightloop@2026');
  const staffPass = hashPassword('StaffLoop@2026');
  const custPass = hashPassword('Customer@2026');

  // Admin
  db.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, name, role, customer_id, created_at)
    VALUES (?, 'admin@brightloop.com', ?, ?, 'Sarah Jenkins (Admin)', 'admin', NULL, ?)
  `).run(crypto.randomUUID(), adminPass.passwordHash, adminPass.passwordSalt, now);

  // Staff
  db.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, name, role, customer_id, created_at)
    VALUES (?, 'sales@brightloop.com', ?, ?, 'Mark Thompson (Sales & Billing)', 'staff', NULL, ?)
  `).run(crypto.randomUUID(), staffPass.passwordHash, staffPass.passwordSalt, now);

  // Customers
  db.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, name, role, customer_id, created_at)
    VALUES (?, 'alice@acmeshop.com', ?, ?, 'Alice Miller', 'customer', ?, ?)
  `).run(crypto.randomUUID(), custPass.passwordHash, custPass.passwordSalt, custAcmeId, now);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, name, role, customer_id, created_at)
    VALUES (?, 'dave@nexusglobal.com', ?, ?, 'David Sterling', 'customer', ?, ?)
  `).run(crypto.randomUUID(), custPass.passwordHash, custPass.passwordSalt, custNexusId, now);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, name, role, customer_id, created_at)
    VALUES (?, 'ops@cloudscale.io', ?, ?, 'Elena Rostova', 'customer', ?, ?)
  `).run(crypto.randomUUID(), custPass.passwordHash, custPass.passwordSalt, custCloudId, now);

  // 4. Seed Products & Variants
  // Product 1: Brightloop ERP Core
  const prodErpId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes, active, created_at)
    VALUES (?, 'Brightloop ERP Platform', 'software', 1200.0, 300.0, 'Core subscription software for enterprise accounting & inventory', 1, ?)
  `).run(prodErpId, now);

  // Variants: As specified in scene: "by brand, where choosing the Odoo brand adds 560 to the price"
  const varOdooId = crypto.randomUUID();
  const varStandardId = crypto.randomUUID();
  const varSapId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO product_variants (id, product_id, attribute_name, option_name, price_adjustment, created_at)
    VALUES (?, ?, 'Brand', 'Odoo Brand Connector', 560.0, ?)
  `).run(varOdooId, prodErpId, now);

  db.prepare(`
    INSERT INTO product_variants (id, product_id, attribute_name, option_name, price_adjustment, created_at)
    VALUES (?, ?, 'Brand', 'Standard Native Edition', 0.0, ?)
  `).run(varStandardId, prodErpId, now);

  db.prepare(`
    INSERT INTO product_variants (id, product_id, attribute_name, option_name, price_adjustment, created_at)
    VALUES (?, ?, 'Brand', 'SAP Enterprise Sync', 950.0, ?)
  `).run(varSapId, prodErpId, now);

  // Product 2: AI Automation Copilot
  const prodAiId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes, active, created_at)
    VALUES (?, 'AI Workflow Copilot', 'software', 350.0, 80.0, 'Autonomous agents for billing, intake and ticket triage', 1, ?)
  `).run(prodAiId, now);

  // Product 3: Add-on 24/7 Dedicated Support
  const prodSupportId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes, active, created_at)
    VALUES (?, '24/7 Dedicated SLA Support', 'addon', 250.0, 45.0, '15-minute response SLA with dedicated technical account manager', 1, ?)
  `).run(prodSupportId, now);

  // Product 4: Add-on Multi-Currency Financials
  const prodCurrencyId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes, active, created_at)
    VALUES (?, 'Multi-Currency Settlement Engine', 'addon', 180.0, 30.0, 'Automated FX conversion and multi-currency ledger support', 1, ?)
  `).run(prodCurrencyId, now);

  // Product 5: Add-on Real-time Audit Vault
  const prodVaultId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO products (id, name, type, sales_price, cost_price, notes, active, created_at)
    VALUES (?, 'Immutable Audit Vault & Backups', 'addon', 95.0, 15.0, 'SOC2 compliant append-only ledger and hourly offsite snapshots', 1, ?)
  `).run(prodVaultId, now);

  // 5. Seed Plans
  const planStarterMonthlyId = crypto.randomUUID();
  const planProMonthlyId = crypto.randomUUID();
  const planEnterpriseYearlyId = crypto.randomUUID();
  const planSprintWeeklyId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO plans (
      id, name, product_id, base_cost, billing_frequency, min_quantity,
      valid_from, valid_to, auto_close_on_expiry, allow_early_close,
      allow_pause, allow_renewal, active, created_at
    ) VALUES (?, 'Starter Tier (Monthly)', ?, 350.0, 'monthly', 1, '2026-01-01', NULL, 0, 1, 1, 1, 1, ?)
  `).run(planStarterMonthlyId, prodAiId, now);

  db.prepare(`
    INSERT INTO plans (
      id, name, product_id, base_cost, billing_frequency, min_quantity,
      valid_from, valid_to, auto_close_on_expiry, allow_early_close,
      allow_pause, allow_renewal, active, created_at
    ) VALUES (?, 'Professional Suite (Monthly)', ?, 1200.0, 'monthly', 1, '2026-01-01', NULL, 0, 1, 1, 1, 1, ?)
  `).run(planProMonthlyId, prodErpId, now);

  db.prepare(`
    INSERT INTO plans (
      id, name, product_id, base_cost, billing_frequency, min_quantity,
      valid_from, valid_to, auto_close_on_expiry, allow_early_close,
      allow_pause, allow_renewal, active, created_at
    ) VALUES (?, 'Enterprise Global Contract (Yearly)', ?, 14400.0, 'yearly', 5, '2026-01-01', NULL, 1, 0, 0, 1, 1, ?)
  `).run(planEnterpriseYearlyId, prodErpId, now);

  db.prepare(`
    INSERT INTO plans (
      id, name, product_id, base_cost, billing_frequency, min_quantity,
      valid_from, valid_to, auto_close_on_expiry, allow_early_close,
      allow_pause, allow_renewal, active, created_at
    ) VALUES (?, 'Rapid Pilot Accelerator (Weekly)', ?, 150.0, 'weekly', 1, '2026-01-01', '2027-12-31', 1, 1, 0, 1, 1, ?)
  `).run(planSprintWeeklyId, prodAiId, now);

  // 6. Seed Quotation Templates
  const tmplEnterpriseId = crypto.randomUUID();
  const tmplStarterId = crypto.randomUUID();

  const enterpriseTemplateLines = [
    { product_id: prodErpId, variant_id: varOdooId, quantity: 5, description: 'Brightloop ERP Platform (Brand: Odoo [+$560])' },
    { product_id: prodSupportId, quantity: 1, is_addon: 1, description: '24/7 Dedicated SLA Support' },
    { product_id: prodCurrencyId, quantity: 1, is_addon: 1, description: 'Multi-Currency Settlement Engine' }
  ];

  db.prepare(`
    INSERT INTO quotation_templates (id, name, plan_id, validity_days, lines_json, notes, created_at)
    VALUES (?, 'Standard Enterprise ERP Offer', ?, 30, ?, 'Standard template for high-touch enterprise accounts with Odoo brand connector', ?)
  `).run(tmplEnterpriseId, planEnterpriseYearlyId, JSON.stringify(enterpriseTemplateLines), now);

  const starterTemplateLines = [
    { product_id: prodAiId, quantity: 1, description: 'AI Workflow Copilot' },
    { product_id: prodVaultId, quantity: 1, is_addon: 1, description: 'Immutable Audit Vault & Backups' }
  ];

  db.prepare(`
    INSERT INTO quotation_templates (id, name, plan_id, validity_days, lines_json, notes, created_at)
    VALUES (?, 'SMB Starter Launchpad Offer', ?, 14, ?, 'Ready-to-sign quotation for small businesses', ?)
  `).run(tmplStarterId, planStarterMonthlyId, JSON.stringify(starterTemplateLines), now);

  // 7. Seed Discounts (Admin scene: "fixed amount or a percentage, with a minimum purchase or quantity...")
  const discVolumeId = crypto.randomUUID();
  const discOdooId = crypto.randomUUID();
  const discEarlyId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO discounts (
      id, code, name, discount_type, discount_value, min_purchase_amount,
      min_quantity, start_date, end_date, max_uses, used_count, scope, product_id, active, created_at
    ) VALUES (?, 'VOL15', 'Volume 15% Enterprise Saver', 'percentage', 15.0, 2000.0, 3, '2026-01-01', '2027-12-31', 100, 3, 'subscription', NULL, 1, ?)
  `).run(discVolumeId, now);

  db.prepare(`
    INSERT INTO discounts (
      id, code, name, discount_type, discount_value, min_purchase_amount,
      min_quantity, start_date, end_date, max_uses, used_count, scope, product_id, active, created_at
    ) VALUES (?, 'ODOOBONUS', '$200 Odoo Migration Credit', 'fixed', 200.0, 1000.0, 1, '2026-01-01', '2027-12-31', 50, 2, 'product', ?, 1, ?)
  `).run(discOdooId, prodErpId, now);

  db.prepare(`
    INSERT INTO discounts (
      id, code, name, discount_type, discount_value, min_purchase_amount,
      min_quantity, start_date, end_date, max_uses, used_count, scope, product_id, active, created_at
    ) VALUES (?, 'WELCOME50', '$50 New Customer Welcome', 'fixed', 50.0, 300.0, 1, '2026-01-01', '2027-12-31', 200, 5, 'subscription', NULL, 1, ?)
  `).run(discEarlyId, now);

  // 8. Seed Subscriptions across all lifecycle states
  // SUB 1: Active - Nexus Global (Enterprise Annual with Odoo variant + add-ons)
  const sub1Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, last_billed_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, 'SUB-2026-0001', ?, ?, 'Active', '2026-01-01', '2027-01-01', ?, '2026-01-01', 'Net 30', 'Enterprise contract with Odoo brand connector', ?, ?)
  `).run(sub1Id, custNexusId, planEnterpriseYearlyId, today, now, now);

  // Lines for SUB 1: ERP with Odoo variant ($1200 + $560 = $1760 each x 5 = $8800)
  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, ?, 'Brightloop ERP Platform (Brand: Odoo Connector [+$560])', 5, 1760.0, ?, 8800.0, 0, 1)
  `).run(crypto.randomUUID(), sub1Id, prodErpId, varOdooId, taxVatId);

  // Support Add-on ($250)
  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, NULL, '24/7 Dedicated SLA Support', 1, 250.0, ?, 250.0, 1, 1)
  `).run(crypto.randomUUID(), sub1Id, prodSupportId, taxVatId);

  // SUB 2: Active - Acme Retail (Monthly Plan with toggled add-ons)
  const sub2Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, last_billed_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, 'SUB-2026-0002', ?, ?, 'Active', '2026-09-01', '2027-09-01', ?, '2026-10-01', 'Net 15', 'Monthly small shop subscription', ?, ?)
  `).run(sub2Id, custAcmeId, planStarterMonthlyId, today, now, now);

  // Lines for SUB 2: AI Copilot ($350) + Backup add-on ($95 active) + Support add-on ($250 inactive)
  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, NULL, 'AI Workflow Copilot', 1, 350.0, ?, 350.0, 0, 1)
  `).run(crypto.randomUUID(), sub2Id, prodAiId, taxVatId);

  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, NULL, 'Immutable Audit Vault & Backups', 1, 95.0, ?, 95.0, 1, 1)
  `).run(crypto.randomUUID(), sub2Id, prodVaultId, taxVatId);

  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, NULL, '24/7 Dedicated SLA Support (Optional Add-on)', 1, 250.0, ?, 0.0, 1, 0)
  `).run(crypto.randomUUID(), sub2Id, prodSupportId, taxVatId);

  // SUB 3: Active - CloudScale Ltd (Professional Suite Monthly)
  const sub3Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, last_billed_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, 'SUB-2026-0003', ?, ?, 'Active', '2026-08-15', '2027-08-15', '2026-11-15', '2026-10-15', 'Net 15', 'Pro Suite for tech scaleup', ?, ?)
  `).run(sub3Id, custCloudId, planProMonthlyId, now, now);

  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, ?, 'Brightloop ERP Platform (Standard Native)', 2, 1200.0, ?, 2400.0, 0, 1)
  `).run(crypto.randomUUID(), sub3Id, prodErpId, varStandardId, taxVatId);

  // SUB 4: Quotation - Vertex Labs (Sales rep prepared offer from template)
  const sub4Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, 'SUB-2026-0004', ?, ?, 'Quotation', '2026-11-01', '2027-11-01', '2026-11-01', 'Net 30', 'Quote prepared from Enterprise ERP template', ?, ?)
  `).run(sub4Id, custVertexId, planEnterpriseYearlyId, now, now);

  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, ?, 'Brightloop ERP Platform (Brand: Odoo Connector [+$560])', 3, 1760.0, ?, 5280.0, 0, 1)
  `).run(crypto.randomUUID(), sub4Id, prodErpId, varOdooId, taxVatId);

  // SUB 5: Draft - New negotiation
  const sub5Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, 'SUB-2026-0005', ?, ?, 'Draft', '2026-11-15', '2027-11-15', '2026-11-15', 'Net 30', 'Draft proposal under internal review', ?, ?)
  `).run(sub5Id, custCloudId, planStarterMonthlyId, now, now);

  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, NULL, 'AI Workflow Copilot', 1, 350.0, ?, 350.0, 0, 1)
  `).run(crypto.randomUUID(), sub5Id, prodAiId, taxVatId);

  // SUB 6: Paused - Acme Secondary
  const sub6Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO subscriptions (
      id, subscription_number, customer_id, plan_id, status,
      start_date, expiry_date, next_billing_date, payment_terms, notes, created_at, updated_at
    ) VALUES (?, 'SUB-2026-0006', ?, ?, 'Paused', '2026-05-01', '2027-05-01', '2026-12-01', 'Net 15', 'Paused during seasonal inventory audit', ?, ?)
  `).run(sub6Id, custAcmeId, planStarterMonthlyId, now, now);

  db.prepare(`
    INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, line_total, is_addon, active)
    VALUES (?, ?, ?, NULL, 'AI Workflow Copilot', 1, 350.0, ?, 350.0, 0, 1)
  `).run(crypto.randomUUID(), sub6Id, prodAiId, taxVatId);

  // 9. Seed Invoices & Payments (Paid, Confirmed, and Overdue for Finance lead scene)
  // Invoice 1: Fully Paid Invoice (Acme Retail - Sep)
  const inv1Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO invoices (
      id, invoice_number, subscription_id, customer_id, status,
      issue_date, due_date, subtotal, tax_total, discount_total,
      total_amount, amount_paid, balance_due, currency,
      billing_period_start, billing_period_end, notes, sent_at, created_at
    ) VALUES (?, 'INV-2026-0001', ?, ?, 'Paid', '2026-09-01', '2026-09-16', 445.0, 89.0, 0.0, 534.0, 534.0, 0.0, 'USD', '2026-09-01', '2026-10-01', 'Monthly billing', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z')
  `).run(inv1Id, sub2Id, custAcmeId);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, product_id, description, quantity, unit_price, tax_name, tax_rate, tax_amount, line_total)
    VALUES (?, ?, ?, 'AI Workflow Copilot', 1, 350.0, 'Standard VAT (20%)', 20.0, 70.0, 420.0)
  `).run(crypto.randomUUID(), inv1Id, prodAiId);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, product_id, description, quantity, unit_price, tax_name, tax_rate, tax_amount, line_total)
    VALUES (?, ?, ?, 'Immutable Audit Vault & Backups', 1, 95.0, 'Standard VAT (20%)', 20.0, 19.0, 114.0)
  `).run(crypto.randomUUID(), inv1Id, prodVaultId);

  db.prepare(`
    INSERT INTO payments (id, invoice_id, payment_number, payment_method, amount, payment_date, reference_note, recorded_by, created_at)
    VALUES (?, ?, 'PAY-2026-0001', 'Stripe', 534.0, '2026-09-05', 'Automated credit card settlement ch_9384721', 'Stripe Webhook', '2026-09-05T14:20:00Z')
  `).run(crypto.randomUUID(), inv1Id);

  // Invoice 2: OVERDUE Invoice (Nexus Enterprise - Due 35 days ago!)
  const inv2Id = crypto.randomUUID();
  const pastDueDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const pastIssueDate = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO invoices (
      id, invoice_number, subscription_id, customer_id, status,
      issue_date, due_date, subtotal, tax_total, discount_total,
      total_amount, amount_paid, balance_due, currency,
      billing_period_start, billing_period_end, notes, sent_at, created_at
    ) VALUES (?, 'INV-2026-0002', ?, ?, 'Confirmed', ?, ?, 9050.0, 1810.0, 1357.5, 9502.5, 2000.0, 7502.5, 'USD', ?, ?, 'Annual Enterprise Billing with Volume Discount', ?, ?)
  `).run(inv2Id, sub1Id, custNexusId, pastIssueDate, pastDueDate, pastIssueDate, pastDueDate, pastIssueDate, pastIssueDate);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, product_id, variant_id, description, quantity, unit_price, tax_name, tax_rate, tax_amount, line_total)
    VALUES (?, ?, ?, ?, 'Brightloop ERP Platform (Brand: Odoo Connector [+$560])', 5, 1760.0, 'Standard VAT (20%)', 20.0, 1760.0, 10560.0)
  `).run(crypto.randomUUID(), inv2Id, prodErpId, varOdooId);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, product_id, description, quantity, unit_price, tax_name, tax_rate, tax_amount, line_total)
    VALUES (?, ?, ?, '24/7 Dedicated SLA Support', 1, 250.0, 'Standard VAT (20%)', 20.0, 50.0, 300.0)
  `).run(crypto.randomUUID(), inv2Id, prodSupportId);

  // Partial Payment on Invoice 2
  db.prepare(`
    INSERT INTO payments (id, invoice_id, payment_number, payment_method, amount, payment_date, reference_note, recorded_by, created_at)
    VALUES (?, ?, 'PAY-2026-0002', 'Bank Transfer', 2000.0, ?, 'Partial wire transfer received from Nexus Treasury', 'Mark Thompson (Sales & Billing)', ?)
  `).run(crypto.randomUUID(), inv2Id, pastDueDate, pastDueDate);

  // Invoice 3: Open Confirmed Invoice (CloudScale Ltd - Due in 10 days)
  const inv3Id = crypto.randomUUID();
  const futureDueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recentIssueDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO invoices (
      id, invoice_number, subscription_id, customer_id, status,
      issue_date, due_date, subtotal, tax_total, discount_total,
      total_amount, amount_paid, balance_due, currency,
      billing_period_start, billing_period_end, notes, sent_at, created_at
    ) VALUES (?, 'INV-2026-0003', ?, ?, 'Confirmed', ?, ?, 2400.0, 480.0, 0.0, 2880.0, 0.0, 2880.0, 'USD', ?, ?, 'Monthly ERP Subscription', ?, ?)
  `).run(inv3Id, sub3Id, custCloudId, recentIssueDate, futureDueDate, recentIssueDate, futureDueDate, recentIssueDate, recentIssueDate);

  db.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, product_id, variant_id, description, quantity, unit_price, tax_name, tax_rate, tax_amount, line_total)
    VALUES (?, ?, ?, ?, 'Brightloop ERP Platform (Standard Native)', 2, 1200.0, 'Standard VAT (20%)', 20.0, 480.0, 2880.0)
  `).run(crypto.randomUUID(), inv3Id, prodErpId, varStandardId);

  // 10. Audit Logs
  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, user_name, action, entity_type, entity_id, details)
    VALUES (?, ?, 'System Initializer', 'SEED_SYSTEM', 'database', 'brightloop', 'Platform initialized with default products, plans, taxes, discounts, and demo subscriptions')
  `).run(crypto.randomUUID(), now);

  console.log('✅ Brightloop Subscription System seeded successfully!');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };

