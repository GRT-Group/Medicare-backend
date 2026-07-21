# Quotation API Documentation

Professional quotation management for building, sending, tracking, and converting customer proposals.

## Base URL

```
/api/quotations
```

## Authentication Headers

All endpoints require these headers:

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `x-organization-id` | string | ✅ | Organization ID (numeric) |
| `x-user-id` | string | ✅* | User ID performing the action |
| `Authorization` | string | ✅ | `Bearer <token>` from login |

> `x-user-id` is required for write operations (POST, PUT, DELETE).

---

## Quotation Status Workflow

```
  ┌──────────┐
  │  DRAFT   │ ← initial state (also reopen target)
  └────┬─────┘
       │ send
       ▼
  ┌──────────┐
  │   SENT   │ ← emailed to customer
  └────┬─────┘
       │
   ┌───┼──────────┐
   │   │           │
   ▼   ▼           ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│ACCEPTED│  │ REJECTED │  │ EXPIRED  │
└───┬────┘  └────┬─────┘  └────┬─────┘
    │            │              │
    │ convert    │ reopen       │ reopen
    ▼            ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│CONVERTED │  │  DRAFT   │  │  DRAFT   │
└──────────┘  └──────────┘  └──────────┘
  (terminal)
```

### Valid Status Transitions

| From | Allowed To |
|------|-----------|
| `DRAFT` | `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CONVERTED` |
| `SENT` | `ACCEPTED`, `REJECTED`, `EXPIRED`, `DRAFT` |
| `ACCEPTED` | `CONVERTED`, `REJECTED` |
| `REJECTED` | `DRAFT` |
| `EXPIRED` | `DRAFT` |
| `CONVERTED` | *(none — terminal state)* |

---

## Endpoints

### 1. List Quotations

```
GET /api/quotations
```

Returns all active (non-deleted) quotations for the organization.

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "42",
      "organization_id": "1",
      "quotation_number": "QT-A3F8B12C",
      "type": "SALES",
      "status": "DRAFT",
      "customer_id": "5",
      "customer_name": "GASORE Alipe",
      "customer_email": "gasore@example.com",
      "customer_phone": "0786485989",
      "subtotal": "2900.00",
      "tax_amount": "464.00",
      "discount_amount": "0.00",
      "total_amount": "3364.00",
      "validity_date": "2026-07-30T00:00:00.000Z",
      "notes": "Bulk order discount applied",
      "branch_id": "1",
      "created_by_id": "3",
      "timestamp": "2026-07-21T10:30:00.000Z",
      "items": [
        {
          "id": "101",
          "product_id": "8",
          "quantity": 10,
          "unit_price": "290.00",
          "subtotal": "2900.00",
          "tax_amount": "464.00",
          "discount_amount": "0.00",
          "Product": {
            "id": "8",
            "name": "Paracetamol 500mg"
          }
        }
      ],
      "Customer": { "id": "5", "name": "GASORE Alipe" },
      "Supplier": null
    }
  ]
}
```

---

### 2. Create Quotation

```
POST /api/quotations
```

**Request Body**
```json
{
  "type": "SALES",
  "customer_id": "5",
  "customer_name": "GASORE Alipe",
  "customer_email": "gasore@example.com",
  "customer_phone": "0786485989",
  "branch_id": "1",
  "validity_date": "2026-07-30",
  "discount_amount": 500,
  "notes": "Bulk order for clinic",
  "items": [
    {
      "product_id": "8",
      "quantity": 10,
      "unit_price": 290,
      "line_discount": 0,
      "tax_rate": 0.16
    },
    {
      "product_id": "12",
      "quantity": 5,
      "unit_price": 1500,
      "line_discount": 200,
      "tax_rate": 0.16
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | No | `SALES` (default) or `PURCHASE` |
| `customer_id` | string | No | Existing customer ID |
| `customer_name` | string | No | Customer name (for walk-in) |
| `customer_email` | string | No | Email to send quotation to |
| `customer_phone` | string | No | Contact phone |
| `branch_id` | string | No | Branch ID |
| `validity_date` | string | No | ISO date — offer expires after this |
| `discount_amount` | number | No | Header-level discount amount |
| `notes` | string | No | Internal/customer notes |
| `items` | array | ✅ | At least one item required |
| `items[].product_id` | string | ✅ | Product ID |
| `items[].quantity` | number | ✅ | Quantity |
| `items[].unit_price` | number | ✅ | Unit price |
| `items[].line_discount` | number | No | Per-line discount (default 0) |
| `items[].tax_rate` | number | No | Tax rate as decimal (e.g. 0.16 for 16%) |

> For `PURCHASE` quotations, `supplier_id` is required instead of `customer_id`.

**Response** — `201 Created`
```json
{
  "success": true,
  "data": { /* full quotation object with items */ }
}
```

---

### 3. Get Single Quotation

```
GET /api/quotations/:id
```

**Response**
```json
{
  "success": true,
  "data": { /* full quotation object with items, Customer, Supplier */ }
}
```

---

### 4. Update Quotation

```
PUT /api/quotations/:id
```

Update customer info, items, notes, or validity date. Only `DRAFT` and `SENT` quotations can be edited.

**Request Body** — same fields as create (all optional). If `items` is provided, existing items are replaced entirely.

```json
{
  "customer_name": "Updated Name",
  "validity_date": "2026-08-15",
  "notes": "Updated notes",
  "items": [
    {
      "product_id": "8",
      "quantity": 20,
      "unit_price": 280,
      "tax_rate": 0.16
    }
  ]
}
```

**Response**
```json
{
  "success": true,
  "data": { /* updated quotation with items */ }
}
```

**Errors**
- `400` — Quotation not found or status doesn't allow editing

---

### 5. Delete Quotation

```
DELETE /api/quotations/:id
```

Soft-deletes the quotation. Converted quotations cannot be deleted (they are linked to a sale).

**Response**
```json
{
  "success": true,
  "message": "Quotation deleted successfully."
}
```

---

### 6. Update Status

```
PUT /api/quotations/:id/status
```

Change the quotation status. Only valid transitions are allowed (see workflow above).

**Request Body**
```json
{
  "status": "ACCEPTED"
}
```

| Value | Description |
|-------|-------------|
| `DRAFT` | Work in progress, not sent |
| `SENT` | Emailed/shared with customer |
| `ACCEPTED` | Customer accepted the offer |
| `REJECTED` | Customer declined |
| `EXPIRED` | Past validity date |
| `CONVERTED` | Turned into a sale (set automatically by /convert) |

**Response**
```json
{
  "success": true,
  "data": { /* updated quotation */ }
}
```

**Errors**
- `400` — Invalid transition (e.g. `CONVERTED → DRAFT`)

---

### 7. Send Quotation (Email)

```
POST /api/quotations/:id/send
```

Marks the quotation as `SENT` and emails a professional, itemized quotation to the customer's email address.

- If `customer_email` is not set on the quotation, the status is updated but no email is sent.
- Can be called on `DRAFT` or `SENT` quotations (resend).

**Request Body** — none required (empty `{}`)

**Response**
```json
{
  "success": true,
  "data": { /* quotation with status: SENT */ },
  "message": "Quotation sent successfully."
}
```

---

### 8. Duplicate Quotation

```
POST /api/quotations/:id/duplicate
```

Creates a copy of the quotation with:
- A new unique quotation number
- Status reset to `DRAFT`
- Validity date cleared (must be set on the new copy)
- All items cloned

**Request Body** — none required (empty `{}`)

**Response** — `201 Created`
```json
{
  "success": true,
  "data": { /* new quotation clone */ }
}
```

---

### 9. Convert to Sale

```
POST /api/quotations/:id/convert
```

Converts an accepted quotation into a real sale. This:
1. Creates a sale via `SaleService.processSale` (deducts stock, records payment)
2. Marks the quotation as `CONVERTED`

**Request Body**
```json
{
  "payment_method": "CASH",
  "amount_paid": 5000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payment_method` | string | ✅ | `CASH`, `MOBILE_MONEY`, `BANK_TRANSFER`, `CREDIT` |
| `amount_paid` | number | No | Amount paid now (for partial payments) |

**Response** — `201 Created`
```json
{
  "success": true,
  "data": { /* created sale object */ }
}
```

**Errors**
- `400` — Already converted, rejected, or missing payment method

---

### 10. Quotation Statistics

```
GET /api/quotations/stats
```

Returns aggregated dashboard metrics for the quotation pipeline.

**Response**
```json
{
  "success": true,
  "data": {
    "total": 45,
    "total_value": 1250000,
    "accepted_value": 380000,
    "conversion_rate": 22,
    "pipeline_count": 12,
    "pipeline_value": 550000,
    "by_status": {
      "draft": 5,
      "sent": 7,
      "accepted": 8,
      "rejected": 3,
      "expired": 12,
      "converted": 10
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `total` | Total quotations (all statuses) |
| `total_value` | Sum of `total_amount` across all quotations |
| `accepted_value` | Value of ACCEPTED + CONVERTED quotations |
| `conversion_rate` | `(accepted + converted) / total × 100` |
| `pipeline_count` | DRAFT + SENT count (active proposals) |
| `pipeline_value` | DRAFT + SENT total value |
| `by_status` | Breakdown of count per status |

---

## Error Responses

All error responses follow a consistent format:

```json
{
  "success": false,
  "error": "Human-readable error message.",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| `400` | — | Validation error or invalid request |
| `404` | `NOT_FOUND` | Quotation not found |
| `409` | `DUPLICATE` | Duplicate quotation number |
| `503` | `SERVICE_UNAVAILABLE` | Database unreachable |

---

## Example: Full Quotation Lifecycle

```bash
# 1. Create a draft quotation
curl -X POST /api/quotations \
  -H "x-organization-id: 1" \
  -H "x-user-id: 3" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Jean BIHIRA",
    "customer_email": "jean.bihira1@gmail.com",
    "customer_phone": "0786485989",
    "validity_date": "2026-08-01",
    "items": [
      { "product_id": "8", "quantity": 10, "unit_price": 290, "tax_rate": 0.16 }
    ]
  }'

# 2. Send to customer (emails a professional quotation)
curl -X POST /api/quotations/42/send \
  -H "x-organization-id: 1" \
  -H "x-user-id: 3"

# 3. Customer accepts
curl -X PUT /api/quotations/42/status \
  -H "x-organization-id: 1" \
  -d '{ "status": "ACCEPTED" }'

# 4. Convert to sale
curl -X POST /api/quotations/42/convert \
  -H "x-organization-id: 1" \
  -H "x-user-id: 3" \
  -d '{ "payment_method": "CASH", "amount_paid": 3364 }'

# 5. Check pipeline stats
curl -X GET /api/quotations/stats \
  -H "x-organization-id: 1"
```
