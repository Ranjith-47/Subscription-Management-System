# Brightloop Subscription Management System

> **One unified software platform to run plans, subscriptions, and recurring billing in one place.**
> Built for **Brightloop Software** to replace spreadsheets, manual invoices, and quarter-end revenue reporting headaches.

---

## 🌟 Executive Overview & The Challenge Solved

Brightloop Software sells everything on subscription: business software billed by month or year, add-ons customers switch on and off, and products in multiple variants.

Previously:
- **Subscriptions**: Tracked in a messy spreadsheet
- **Renewals**: Missed unless someone remembered
- **Invoices**: Typed by hand every month
- **Payments**: Matched by scrolling through bank statements
- **Revenue reports**: Built manually at end of quarter

With this unified platform, all seven operational scenes are completely automated with real-time accuracy and sub-2 millisecond query performance (surpassing the `< 2 seconds` requirement).

---

## 🚀 Key Features by Billing Month Scene

### Scene 1: A New Customer Signs Up & RBAC Access Control
- **Self-Service Customer Registration**:
  - Enforced password complexity: **more than 8 characters**, at least **one uppercase letter**, **one lowercase letter**, and **one special character** (`!@#$%^&*`).
  - Unique email verification: each email belongs to only one account.
  - Password reset mechanism with expiring secure tokens.
- **Role-Based Access Control (RBAC)**:
  - 👑 **Admin (`admin@brightloop.com`)**: Controls entire system, sets products, plans, tax rules, discount rules, and staff accounts.
  - 💼 **Internal Staff (`sales@brightloop.com`)**: Handles day-to-day work with limited access (creates quotes, converts to subscriptions, triggers billing, records payments).
  - 👤 **Customer Portal (`alice@acmeshop.com`)**: Customers view only their own subscriptions and invoices, toggle add-ons, and settle balances.
  - **Staff Security Policy**: **Only the admin can add a new member of staff**.

### Scene 2: Launching Products, Variants & Plans
- **Catalog Management**:
  - Products with name, type (`software`, `addon`, `service`, `hardware`), sales price, cost price, and notes.
  - **Product Variants**: Attributes and option values with dynamic price adjustments. E.g., choosing the **Odoo Brand Connector adds $560** to base price.
- **Subscription Plans & Policies**:
  - Base cost and flexible frequencies: `daily`, `weekly`, `monthly`, or `yearly`.
  - Minimum quantities and validity date windows (`valid_from` to `valid_to`).
  - Per-plan lifecycle policies:
    - `auto_close_on_expiry`: Automatically terminates when validity ends.
    - `allow_early_close`: Controls whether users can close early.
    - `allow_pause`: Governs whether subscriptions can be paused.
    - `allow_renewal`: Configures renewal eligibility.

### Scene 3: Quotation Templates & Turning Quotes into Subscriptions
- **Quotation Templates**:
  - Pre-packaged with plan, product lines, quantities, and validity duration (e.g., 14 or 30 days).
  - Sales reps generate offers in seconds without starting from scratch.
- **Subscription Lifecycle State Machine**:
  - Complete state transitions:
    $$\text{Draft} \longrightarrow \text{Quotation} \longrightarrow \text{Confirmed} \longrightarrow \text{Active} \longleftrightarrow \text{Paused} \longrightarrow \text{Closed}$$
  - Each subscription tracks a unique number (e.g. `SUB-2026-0001`), customer, plan, start/expiry dates, payment terms, and line items.

### Scene 4: Billing Day & Automated Invoicing
- **One-Click Recurring Batch Engine**:
  - Evaluates all `Active` subscriptions due on or before billing day.
  - Generates invoices with line items, tax rules, and active add-ons.
  - **Idempotency & Duplicate Prevention**: Guarantees nothing is billed twice or skipped by tracking billing periods.
  - Advances `next_billing_date` based on frequency (daily, weekly, monthly, yearly).
- **Tax Engine**:
  - Admin-configured rules (e.g., *Standard VAT 20%*, *US Sales Tax 8.5%*, *Zero Rated 0%*).
- **Invoice Lifecycle**:
  - `Draft` $\rightarrow$ `Confirmed` $\rightarrow$ `Paid` (or `Cancelled`).
  - Send, confirm, and print invoice PDF views.

### Scene 5: Admin Discount Rules & Automated Application
- **Discount Rules (Admin-Only)**:
  - Fixed dollar amount or percentage off.
  - Qualification thresholds: Minimum purchase amount or minimum seat quantity.
  - Validity date windows and maximum usage count limits.
  - Scope: whole subscription or specific product line.
- **Automatic Execution**:
  - Automatically evaluated and applied during billing day.
  - Stops automatically once validity dates expire or max usage limit is exhausted.

### Scene 6: Payment Recording & Real-time Settlement
- **Payment Methods Supported**:
  - Bank Transfer, Credit Card, Stripe, Check, Cash, Wire Transfer.
- **Real-time Settlement**:
  - Supports full and partial payments.
  - Updates `amount_paid` and `balance_due`.
  - Automatically transitions invoice to `Paid` once fully settled.
- **Overdue Detection & Chasing**:
  - Detects overdue invoices past payment terms.
  - One-click **"Chase Reminder"** with timestamped audit logging.

### Scene 7: The Finance Lead Dashboard (< 2s Performance SLA)
- **Executive Metrics in One Place**:
  - **MRR (Monthly Recurring Revenue)**: Normalized from daily, weekly, monthly, and yearly subscriptions.
  - **ARR (Annual Run Rate)**: $\text{MRR} \times 12$.
  - **Revenue Collected** vs **Total Outstanding Owed**.
  - **Aging Analysis Buckets**: 1-30 days, 31-60 days, 61-90 days, 90+ days overdue.
  - **Performance Benchmark**: Powered by optimized SQLite indexes in WAL mode; **query response takes under 2 milliseconds**, easily meeting the `< 2s` threshold.

---

## 🛠️ Architecture & Tech Stack

```
c:\Users\ASUS\Desktop\all apps\2026\2027\hack\
├── server.js                        # High-performance HTTP server & static router
├── package.json                     # Project scripts and metadata
├── src/
│   ├── db/
│   │   ├── database.js              # SQLite WAL schema, tables & indexes
│   │   └── seed.js                  # Realistic Brightloop scenario seed data
│   ├── services/
│   │   ├── authService.js           # Password complexity, PBKDF2 hashing, RBAC
│   │   ├── subscriptionService.js   # Lifecycle transitions, variants, add-ons
│   │   ├── billingEngine.js         # Batch billing day, taxes, discounts
│   │   ├── paymentService.js        # Payment recording, overdue chasing
│   │   └── analyticsService.js      # MRR, ARR, aging analysis (< 2s)
│   ├── routes/
│   │   └── api.js                   # REST API routes
│   └── tests/
│       ├── run_tests.js             # 11-step end-to-end scenario verification
│       └── test_api_endpoints.js    # Mock router REST integration tests
└── public/
    ├── index.html                   # Modern responsive Single Page App
    ├── app.js                       # Frontend reactive state & persona switching
    └── styles.css                   # Glassmorphism, animations, print media
```

- **Runtime**: Node.js 24 (Zero external npm runtime dependency vulnerabilities)
- **Database**: Native `node:sqlite` in WAL (Write-Ahead Logging) mode with foreign keys and multi-column indexes
- **Security**: PBKDF2 with unique salts, crypto session tokens, strict RBAC
- **Frontend**: Clean semantic HTML5, Tailwind CSS, Lucide icons, responsive layout with printable invoice views.

---

## 🧪 Automated Test Suite

Run the full verification suite testing all 11 business rules and all API endpoints:

```bash
npm test
```

### Verification Output:
```
✔ Test 1: Password rules and unique email verified
✔ Test 2: Only admin can add staff member verified (RBAC)
✔ Test 3: Password reset flow verified
✔ Test 4: Product variants (Odoo +$560) verified
✔ Test 5: Plan policies (billing frequency, auto-close, pause, renewal) verified
✔ Test 6: Quotation template & subscription state machine verified
✔ Test 7: Customer self-service add-on toggle verified
✔ Test 8: Billing Day, discount auto-calculation & idempotency verified
✔ Test 9: Recording payments (partial & full settlement) verified
✔ Test 10: Overdue detection and reminder chasing verified
✔ Test 11: Finance Lead analytics computed in 0ms (SLA: < 2000ms)

✔ ALL REST API ENDPOINTS VERIFIED 100%!
```

---

## 💻 Running the Web Application

To launch the system:

```bash
npm start
```

Then open your browser at:
👉 **`http://localhost:3000`**

### Pre-configured Demo Accounts:
- **Admin**: `admin@brightloop.com` / `Brightloop@2026`
- **Internal Staff**: `sales@brightloop.com` / `StaffLoop@2026`
- **Customer (Alice Miller)**: `alice@acmeshop.com` / `Customer@2026`
- **Customer (David Sterling - Enterprise)**: `dave@nexusglobal.com` / `Customer@2026`

