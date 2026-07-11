# Purchase Order API

Reference for the procurement flow: create a PO (defaults to `PENDING`, emails the supplier), then confirm it as received (updates inventory).

All endpoints require `Authorization: Bearer <token>`. Organization/user/branch are derived from the verified token — no `x-organization-id`/`x-user-id` headers needed anymore.

---

## 1. List purchase orders

```
GET /api/purchases
Authorization: Bearer <token>
```

```json
[
  {
    "purchaseOrder": {
      "id": "7",
      "supplierId": "7",
      "supplierName": "Emmanuel Nkurunziza",
      "totalAmount": "60000",
      "status": "PENDING",
      "createdAt": "2026-07-08T10:30:00.000Z",
      "items": [
        { "productId": "6", "productName": "Oxytetracycline 100ml", "quantity": 50, "purchasePrice": "1200" }
      ]
    }
  }
]
```

---

## 2. Create a purchase order

```
POST /api/purchases
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "supplier_id": 7,
  "expected_delivery_date": "2026-08-01",
  "items": [
    { "product_id": 6, "expected_quantity": 50, "unit_cost": 1200 },
    { "product_id": 9, "expected_quantity": 20, "unit_cost": 800 }
  ]
}
```
`expected_delivery_date` is optional. `total_amount` is computed server-side from `items` — don't send it.

**Success (201):**
```json
{ "message": "Purchase order created successfully", "id": "7" }
```

- Status is always `PENDING` on creation — stock is **not** touched yet.
- A real invoice **PDF** is generated in the background (PO number, date, billed-to/issued-by, items, quantities, unit cost, total, expected delivery date) and stored — `PurchaseOrder.invoice_document_url` is set automatically to a downloadable link (Supabase Storage if configured, otherwise `/uploads/purchase-invoices/...` served directly by the app).
- If the supplier has an email on file, that same PDF is emailed to them **as a file attachment**, not just inline HTML. If they have no email, or the email fails to send, the PO is still created successfully — none of this ever blocks the response.
- Fetch the same data (and the file URL) any time via §2a below.

**Errors:**
| Status | Body | Cause |
|---|---|---|
| 401 | `{ error: "Unauthorized: valid bearer token required" }` | missing/invalid token |
| 400 | `{ error: "Missing items" }` | `items` empty/missing |

---

## 2a. Fetch the invoice for a purchase order

```
GET /api/purchases/7/invoice
Authorization: Bearer <token>
```
Structured invoice data, including `invoiceDocumentUrl` — a link to the actual generated PDF file (the same one emailed to the supplier). Use the structured fields to display an in-app summary, or link/download `invoiceDocumentUrl` directly to get the real PDF document.

**Success (200):**
```json
{
  "success": true,
  "data": {
    "poNumber": "PO-000007",
    "id": "7",
    "status": "RECEIVED",
    "totalAmount": "60000",
    "createdAt": "2026-07-08T10:48:51.742Z",
    "expectedDeliveryDate": null,
    "actualDeliveryDate": "2026-07-08T10:39:02.631Z",
    "invoiceDocumentUrl": "/uploads/purchase-invoices/invoice-7-1783508384569.pdf",
    "organization": { "name": "FONI AGROVET SOLUTIONS LTD", "phone": "+250123456789", "email": "contact@foniagrovet.rw", "address": null },
    "supplier": { "id": "7", "name": "Emmanuel Nkurunziza", "email": "emmanuel.nk@example.com", "phone": "0788500600", "address": "Musanze, Northern Province" },
    "items": [
      { "productId": "6", "productName": "Oxytetracycline 100ml", "quantity": 50, "receivedQuantity": 50, "unitCost": "1200", "lineTotal": "60000.00" }
    ]
  }
}
```
`invoiceDocumentUrl` is auto-generated on PO creation. You can overwrite it later via §4 below (e.g. replacing it with a scanned/signed copy) if needed.

**Errors:**
| Status | Body | Cause |
|---|---|---|
| 400 | `{ success:false, error:"Invalid purchase order id" }` | id isn't numeric |
| 404 | `{ success:false, error:"Purchase order not found" }` | doesn't exist / belongs to another org |

**Looking up invoices without knowing the PO id?** Use `GET /api/purchases/invoices?date=YYYY-MM-DD` (optionally `&supplier_id=`) to get every invoice for a given day — see [SUPPLIER_API.md](SUPPLIER_API.md) §9.

---

## 3. Confirm a purchase order as received

This is the **only** way to mark a PO `RECEIVED` — it's what actually creates stock (a `ProductBatch` + inventory increase) and updates the supplier's on-time delivery performance rating.

```
POST /api/purchases
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "action": "RECEIVE",
  "purchaseOrderId": 7,
  "branchId": 1
}
```
`branchId` is optional if your account has a home branch set — it falls back to that automatically.

**Success (200):**
```json
{ "message": "Purchase order received. Stock increased successfully." }
```
Effects: `PurchaseOrder.status → RECEIVED`, `actual_delivery_date` set, a `ProductBatch` created per item (full `expected_quantity`), an inventory increase movement recorded per item, and the supplier's `performance_rating`/lead time updated based on on-time vs. late delivery.

**Errors:**
| Status | Body | Cause |
|---|---|---|
| 400 | `{ error: "Missing purchaseOrderId" }` / `{ error: "Missing branchId" }` | required field missing (and no home branch on the account) |
| 500 | `{ error: "Purchase Order is already received" }` | re-receiving an already-`RECEIVED` PO (idempotency guard) |

---

## 4. Update a purchase order (non-status fields)

```
PUT /api/purchases?id=7
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{ "invoice_document_url": "/uploads/receipts/invoice.pdf" }
```
`invoice_document_url` is already auto-populated with the generated PDF on creation — only send this if you want to replace it (e.g. with a signed/scanned copy uploaded via `/api/uploads`).

You **cannot** set `status: "RECEIVED"` through this endpoint — it's rejected on purpose, because that would skip the stock/batch creation in §3:
```json
{ "success": false, "error": "Use the receive purchase order action to mark a PO as RECEIVED — this also updates inventory." }
```
Other status changes (e.g. cancelling a still-pending PO) are allowed; changing the status of an already-`RECEIVED` PO is not.

---

## 5. Delete a purchase order

```
DELETE /api/purchases?id=7
Authorization: Bearer <token>
```
Blocked if the PO is already `RECEIVED` (stock has already been altered) — soft-deletes otherwise (`status → CANCELLED_PO`).

---

## Suppliers (for the supplier picker / email target)

```
GET /api/suppliers
Authorization: Bearer <token>
```
Returns each supplier including `email` — make sure this is populated if you want the PO email to actually go out; it's silently skipped (not an error) when null.

```
POST /api/suppliers
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{ "name": "Emmanuel Nkurunziza", "phone": "+250788000000", "email": "supplier@example.com" }
```

---

## Status values

`PurchaseOrder.status`: `PENDING` (default on create) → `RECEIVED` (via §3) or `CANCELLED_PO` (via delete). It's a plain string field, not a fixed enum in the schema — always go through the endpoints above rather than writing it directly.
