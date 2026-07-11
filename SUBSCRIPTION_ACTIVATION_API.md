# Subscription Activation API

Reference for wiring the "Workspace Locked" / Subscription Activation screen: status card, plan list, **Pay Online**, and **Submit Manual Payment**.

All endpoints require `Authorization: Bearer <token>` unless noted. All responses use `{ success: boolean, ... }`.

---

## 1. Get current subscription status

```
GET /api/my-subscription
```

Any authenticated user in the organization can call this (read-only).

**Active subscription:**
```json
{
  "success": true,
  "subscription": {
    "id": "19",
    "organizationId": "4",
    "plan": "Max Plan",
    "status": "ACTIVE",
    "startDate": "2026-07-08T05:04:17.923Z",
    "endDate": "2027-01-08T05:04:17.923Z",
    "remainingDays": 184,
    "paymentStatus": "APPROVED",
    "paymentMethod": "MOMO",
    "isActive": true,
    "billing": {
      "months": 6,
      "planPrice": "99999",
      "baseAmount": "599994",
      "discountPercentage": "10",
      "discountAmount": "59999.4",
      "amountDue": "539994.6"
    }
  }
}
```
`startDate`/`endDate` always reflect the **current** subscription period: every approved payment (new plan, plan switch, or renewal) sets `startDate = now` and `endDate = now + months`, replacing whatever period the previous plan had — it never stacks months onto an old/stale end date. `billing` is the pricing snapshot from the most recent payment; `billing.amountDue` is the **final amount after discount** — show this, not `baseAmount`, as the price the org paid/owes. `billing` is `null` if no payment has ever been made yet.

**No subscription (locked / "Workspace Locked" screen state):**
```json
{ "success": true, "subscription": null }
```
Render this as Plan: "None", Status: "INACTIVE", Days Remaining: 0, Payment Method: "N/A".

**Errors:**
| Status | Body | Cause |
|---|---|---|
| 401 | `{ success:false, error:"Unauthorized: valid bearer token required" }` | missing/invalid/expired token |
| 400 | `{ success:false, error:"No organization associated with this user" }` | token has no org |

---

## 2. List plans (for the plan picker)

```
GET /api/subscriptions/plans
```
No auth required (public pricing).

```json
{
  "plans": [
    { "id": "4", "name": "Popular Plan", "price": "35999", "features": { "pos": true, "reports": true, "inventory": true, "users_limit": 3, "branches_limit": 1 } },
    { "id": "5", "name": "Standard Plan", "price": "59999", "features": { "users_limit": 10, "branches_limit": 3 } },
    { "id": "6", "name": "Max Plan", "price": "99999", "features": { "users_limit": 999, "branches_limit": 999, "advanced_analytics": true } }
  ],
  "discounts": [
    { "months": 1, "discount_percentage": "0" },
    { "months": 3, "discount_percentage": "0" },
    { "months": 6, "discount_percentage": "10" },
    { "months": 12, "discount_percentage": "25" }
  ]
}
```
`price` is per-month. Total for a duration = `price * months`, then the matching `discounts[].discount_percentage` (by `months`) is applied automatically server-side — the frontend only needs to display the estimate; the server computes and stores the authoritative amount.

---

## 3. Pay Online (Card / Mobile Money / other gateway)

```
POST /api/my-subscription
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "planId": 5,
  "months": 1,
  "paymentMethod": "MOMO"
}
```
`paymentMethod` for the online path: `"MOMO"`, `"CARD"`, `"BANK_TRANSFER"`, or `"CASH"`. These **activate immediately** — no admin review.

**Success (201/200):**
```json
{
  "success": true,
  "message": "Subscription renewed successfully.",
  "subscription": { "id": "19", "status": "ACTIVE", "end_date": "...", "plan_name": "Standard", ... },
  "payment": { "id": "27", "status": "APPROVED", "amount": "35999", "payment_method": "MOMO", ... }
}
```
Show a success toast and immediately re-fetch `GET /api/my-subscription` to unlock the dashboard (`isActive: true`).

---

## 4. Submit Manual Payment (bank transfer / deposit slip)

Two steps: upload the receipt, then submit the payment request.

### Step 4a — Upload the receipt/proof file

```
POST /api/uploads
Content-Type: multipart/form-data
```
Fields: `file` (PDF/PNG/JPG/WEBP, max 10MB), `kind` = `"receipt"`. No auth required for this step.

```json
{ "success": true, "data": { "url": "/uploads/receipts/1783485000-a1b2c3d4e5f6.pdf" } }
```

### Step 4b — Submit the manual payment request

```
POST /api/my-subscription
Content-Type: application/json
Authorization: Bearer <token>
```
```json
{
  "planId": 5,
  "months": 1,
  "paymentMethod": "MANUAL_INVOICE",
  "receiptUrl": "/uploads/receipts/1783485000-a1b2c3d4e5f6.pdf"
}
```

**Success — goes to PENDING, requires admin approval, does NOT activate yet:**
```json
{
  "success": true,
  "message": "Payment submitted and is pending admin approval.",
  "subscription": { "id": "19", "status": "ACTIVE_OR_PREVIOUS_STATUS", ... },
  "payment": { "id": "26", "status": "PENDING", "payment_method": "MANUAL_INVOICE", "receipt_document_url": "/uploads/receipts/...", ... }
}
```
Show: "Your payment has been submitted and is awaiting admin verification." Do **not** unlock the dashboard yet — re-poll `GET /api/my-subscription`; `isActive` flips to `true` only once an admin approves (see §6) and `subscription.status` becomes `ACTIVE`.

**Validation error (400) if no receipt attached:**
```json
{ "success": false, "error": "A receipt image or PDF URL must be uploaded for manual invoice payments." }
```

---

## 5. Who can pay / renew

Both **Pay Online** and **Submit Manual Payment** (`POST /api/my-subscription`) are gated:
- Allowed: Super Admin, or any user holding the `MANAGE:SUBSCRIPTION` permission (org Admin/Owner roles).
- Blocked (403): everyone else — hide/disable the Pay Online and Manual Payment buttons for these roles in the UI and show:
  > "This organization does not currently have an active subscription. Please contact your Organization Administrator."

```json
{ "success": false, "error": "Forbidden: missing permission MANAGE:SUBSCRIPTION" }
```

`GET /api/my-subscription` (status view) has **no role restriction** — any authenticated org member can see the status card.

---

## 6. Admin approval (manual payments only — internal/back-office use)

```
POST /api/admin/subscriptions/approve
Content-Type: application/json
Authorization: Bearer <super-admin-token>
```
```json
{ "paymentId": 26, "action": "APPROVE" }
```
`action` is `"APPROVE"` or `"REJECT"`. Requires a **Super Admin** bearer token — the acting admin is always the verified token's own identity (no `adminId` is accepted in the body). On approve, the subscription flips to `ACTIVE` and `end_date` is extended.

---

## Quick reference — payment method → outcome

| `paymentMethod` | Requires `receiptUrl` | Result |
|---|---|---|
| `MOMO` / `CARD` / `BANK_TRANSFER` / `CASH` | No | Immediately `ACTIVE`, payment `APPROVED` |
| `MANUAL_INVOICE` | Yes | Payment `PENDING`; subscription unlocks only after admin approval |

## Status/enum values

- `Subscription.status`: `ACTIVE`, `INACTIVE`, `EXPIRED`, `CANCELLED`, `TRIAL`, `PENDING_APPROVAL`
- `SubscriptionPayment.status`: `PENDING`, `APPROVED`, `REJECTED`, `COMPLETED`
- `PaymentMethod`: `CASH`, `CREDIT`, `MOMO`, `CARD`, `BANK_TRANSFER`, `MANUAL_INVOICE`
