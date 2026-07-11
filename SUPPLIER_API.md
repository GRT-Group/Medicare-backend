# Supplier API

Reference for the supplier list/detail pages: full profile fields (create/update), viewing all purchases from a supplier, outstanding balance, and fetching invoices by date.

All endpoints require `Authorization: Bearer <token>`. Organization/user are derived from the verified token.

---

## 1. List suppliers

```
GET /api/suppliers
Authorization: Bearer <token>
```
```json
[
  {
    "id": "7",
    "supplier_code": "SUP-000006",
    "name": "Emmanuel Nkurunziza",
    "supplier_type": "INDIVIDUAL",
    "phone": "0788500600",
    "email": "emmanuel.nk@example.com",
    "address": "Musanze, Northern Province",
    "outstanding_balance": "0",
    "status": "ACTIVE",
    "approval_status": "APPROVED",
    "risk_level": "LOW",
    "performance_rating": "5",
    "last_order_date": null
  }
]
```
This is the table your screenshot shows — `outstanding_balance` → "Outstanding Payable", `approval_status` → the "Approved" badge.

---

## 2. Get a single supplier

```
GET /api/suppliers/7
Authorization: Bearer <token>
```
```json
{ "success": true, "data": { "id": "7", "name": "Emmanuel Nkurunziza", ... } }
```
404 `{ "success": false, "error": "Supplier not found" }` if it doesn't exist or belongs to another org.

---

## 3. View all purchases from a supplier

This is the "where to see all purchases" piece for the supplier page — add a link/button per row (e.g. "View Purchases") pointing here.

```
GET /api/suppliers/7/purchases
Authorization: Bearer <token>
```

**Success (200):**
```json
{
  "success": true,
  "data": {
    "supplier": { "id": "7", "name": "Emmanuel Nkurunziza", "email": "emmanuel.nk@example.com", "...": "..." },
    "summary": {
      "totalOrders": 3,
      "pendingOrders": 1,
      "receivedOrders": 2,
      "cancelledOrders": 0,
      "totalSpend": "83000.00",
      "lastOrderDate": "2026-07-08T10:59:45.402Z"
    },
    "purchaseOrders": [
      {
        "id": "8",
        "status": "PENDING",
        "total_amount": "15000",
        "invoice_document_url": "/uploads/purchase-invoices/invoice-8-....pdf",
        "expected_delivery_date": null,
        "actual_delivery_date": null,
        "items": [
          { "product_id": "6", "expected_quantity": 10, "unit_cost": "1500", "product": { "name": "Oxytetracycline 100ml", "...": "..." } }
        ]
      }
    ]
  }
}
```
- `summary.totalSpend` only counts `RECEIVED` orders (money actually spent on delivered stock — `PENDING`/`CANCELLED_PO` orders don't count towards lifetime spend).
- `purchaseOrders` is newest-first, full detail per order (same shape as `GET /api/purchases`), so you can render the whole history without a second call.
- Use `invoice_document_url` on each order to link/download that order's invoice PDF, or `GET /api/purchases/:id/invoice` for the fuller structured version (see [PURCHASE_ORDER_API.md](PURCHASE_ORDER_API.md)).

**Errors:** 400 invalid id / 404 supplier not found (same shape as §2).

**Alternative — filter the main purchases list instead:**
```
GET /api/purchases?supplier_id=7
Authorization: Bearer <token>
```
Returns the plain list (no summary), in case you already have a purchases table/view and just want it filterable by supplier rather than a dedicated supplier-detail call.

---

## 4. Create / update a supplier — accepted fields

Both `POST /api/suppliers` (create) and `PUT /api/suppliers/:id` (update, partial) accept the **same field set**, in either camelCase (matches a typical form) or snake_case (matches the DB column) — both work, they're mapped internally:

| camelCase (form) | snake_case (DB column) | Notes |
|---|---|---|
| `name` | `name` | required on create |
| `phone` | `phone` | required on create unless `contactInfo` is sent |
| `email` | `email` | |
| `address` | `address` | |
| `country` | `country` | |
| `contactPerson` | `contact_person` | |
| `contactPersonPhone` | `contact_person_phone` | |
| `registrationNumber` | `registration_number` | COMPANY |
| `taxId` | `tax_id` | |
| `nationalId` | `national_id` | INDIVIDUAL |
| `businessCategory` | `business_category` | free text, e.g. "Hardware" |
| `companySize` | `company_size` | free text, e.g. "Small" |
| `website` | `website` | |
| `specialization` | `specialization` | INDIVIDUAL |
| `experienceLevel` | `experience_level` | free text, e.g. "1-3 years" |
| `preferredPaymentMethod` | `preferred_payment_method` | free text, e.g. "Bank Transfer" |
| `currency` | `currency` | defaults to `"RWF"` |
| `creditLimit` | `credit_limit` | numeric |
| `leadTimeDays` | `lead_time_days` | numeric |
| `minimumOrderValue` | `minimum_order_value` | numeric |
| `deliveryAvailability` | `delivery_availability` | free text, e.g. "Local" |
| `internalNotes` | `internal_notes` | |
| `notes` | `notes` | |
| `paymentTerms` | `payment_terms` | |
| `supplierType` | `supplier_type` | `COMPANY` (default) or `INDIVIDUAL` |
| `approvalStatus` | `approval_status` | see status values below |
| `riskLevel` | `risk_level` | `LOW` (default) / `MEDIUM` / `HIGH` |

Notes on how values are handled:
- **Empty strings (`""`) are treated as "clear this field"** and saved as `null` (or `undefined`/skipped for numeric fields) — sending `"creditLimit": ""` does not error, it just means "no credit limit set," same as omitting it.
- **Any field not in this table is silently dropped**, not an error — so a stray/renamed frontend field won't break the whole save, but also won't silently "half work"; if a field you're sending isn't listed here, it isn't being saved and needs a schema addition.
- Response fields (what `GET` returns) are always snake_case, matching every other entity in this API — the mapping above is only for what you *send*.

**Create:**
```
POST /api/suppliers
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "name": "Emmanuel Nkurunziza",
  "contactPerson": "Patrick Yunix",
  "phone": "078109926",
  "email": "yumvagusenga2000@gmail.com",
  "country": "Rwanda",
  "address": "Musanze, Northern Province",
  "registrationNumber": "444",
  "taxId": "33",
  "businessCategory": "Hardware",
  "companySize": "Small",
  "preferredPaymentMethod": "Bank Transfer",
  "currency": "RWF",
  "deliveryAvailability": "Local"
}
```
**Errors:** 400 `{ error: "name is required" }` / `{ error: "phone is required" }` / `{ error: "supplier_type must be one of: COMPANY, INDIVIDUAL" }`.

**Update** (partial — send only changed fields), two equivalent routes:
```
PUT /api/suppliers/7
PUT /api/suppliers?id=7
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{ "creditLimit": 500000, "leadTimeDays": 5, "approvalStatus": "APPROVED" }
```

---

## 6. Delete a supplier

```
DELETE /api/suppliers/7
DELETE /api/suppliers?id=7
Authorization: Bearer <token>
```
Soft delete (recoverable via the archive/recycle-bin system elsewhere in the app).

---

## 7. Supplier performance leaderboard

```
GET /api/suppliers/performance
Authorization: Bearer <token>
```
```json
[
  { "id": "7", "name": "Emmanuel Nkurunziza", "performance_rating": "5", "lead_missing": 0, "_count": { "PurchaseOrder": 2 } }
]
```
Sorted best-performing first. `_count.PurchaseOrder` only counts `RECEIVED` orders. `performance_rating` and `lead_missing` (days late/early) update automatically every time a purchase order is received (see [PURCHASE_ORDER_API.md](PURCHASE_ORDER_API.md) §3).

---

## 8. Outstanding balance / accounts payable

`outstanding_balance` on every supplier (§1, §2) is already the live figure — it's kept in sync automatically: it goes **up** when a credit purchase is recorded and **down** when a payment is recorded (§8b), so you never need to compute it client-side.

**Full accounts-payable view (every supplier's balance + total owed):**
```
GET /api/agrovet/purchasing/payables
Authorization: Bearer <token>
```
```json
{
  "success": true,
  "data": {
    "total_payable": 45000,
    "suppliers": [
      { "id": "7", "name": "Emmanuel Nkurunziza", "outstanding_balance": "45000", "payment_terms": "Cash on delivery" }
    ]
  }
}
```
Requires `VIEW:SUPPLIERS` permission (or admin/higher) and the org's plan to include the `accounting` feature.

**8b. Record a payment to a supplier** (decrements their outstanding balance):
```
POST /api/agrovet/purchasing/payables
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{ "supplier_id": 7, "amount": 20000, "payment_method": "BANK_TRANSFER", "reference": "TXN-001", "note": "Partial settlement" }
```
Requires `MANAGE:SUPPLIERS` permission (or admin/higher). Also logs the payment to the cash book automatically.

---

## 9. Fetch invoices by date

```
GET /api/purchases/invoices?date=2026-07-08
GET /api/purchases/invoices?date=2026-07-08&supplier_id=7
Authorization: Bearer <token>
```
Every purchase order invoice raised **on that calendar date** (optionally scoped to one supplier) — full structured invoice per order (same shape as [PURCHASE_ORDER_API.md](PURCHASE_ORDER_API.md) §2a), so you can show/download every invoice for a given day without knowing PO ids upfront.

```json
{
  "success": true,
  "data": [
    {
      "poNumber": "PO-000008",
      "id": "8",
      "status": "PENDING",
      "totalAmount": "15000",
      "invoiceDocumentUrl": "/uploads/purchase-invoices/invoice-8-....pdf",
      "supplier": { "id": "7", "name": "Emmanuel Nkurunziza", "...": "..." },
      "items": [ { "productName": "Oxytetracycline 100ml", "quantity": 10, "unitCost": "1500", "lineTotal": "15000.00" } ]
    }
  ]
}
```
Empty array (not an error) if nothing was ordered that day. `date` is required — 400 if missing/invalid.

---

## Status values

- `Supplier.approval_status`: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
- `Supplier.status`: free-text, defaults to `ACTIVE`
- `Supplier.risk_level`: `LOW`, `MEDIUM`, `HIGH`
- `Supplier.supplier_type`: `COMPANY`, `INDIVIDUAL`
