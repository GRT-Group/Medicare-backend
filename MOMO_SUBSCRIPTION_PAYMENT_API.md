# Mobile Money Subscription Payment API (via LMBTech)

Real Mobile Money (MTN MOMO, via the LMBTech payment gateway) integration for paying/renewing a subscription. `paymentMethod: "MOMO"` now initiates a genuine payment request instead of auto-approving instantly with no money movement.

Gateway: **LMBTech** (Link Mobile Technology Ltd, https://pay.lmbtech.rw) — this is the gateway this organization actually holds credentials for; it handles MTN MOMO and Card behind one API.

## Setup

Credentials are already in `.env`:
```
LMBTECH_APP_KEY=...
LMBTECH_SECRET_KEY=...
LMBTECH_BASE_URL=https://pay.lmbtech.rw/pay/config/api.php
NEXT_PUBLIC_APP_URL=...   # must be a publicly reachable URL in production — LMBTech's callback can't reach localhost
```
If unset, any MOMO payment attempt returns a clean `503` (`"Mobile Money payment is temporarily unavailable..."`) instead of silently doing nothing.

**Security note:** these credentials were shared directly in a chat session — treat that specific Secret Key as exposed and rotate it in the LMBTech dashboard once testing is done, then update `.env` with the fresh value.

---

## 1. Initiate a MoMo subscription payment

```
POST /api/my-subscription
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "planId": 5,
  "months": 1,
  "paymentMethod": "MOMO",
  "phone": "0788123456"
}
```
`phone` is the payer's Rwandan mobile number — required for MOMO. (Also works the same way via `POST /api/subscriptions/subscribe`.)

**What happens:** a `SubscriptionPayment` row is created (`status: PENDING`), then a real LMBTech collection request is sent — LMBTech/MTN pushes an approval prompt to that phone. LMBTech's own callback URL is set to `{NEXT_PUBLIC_APP_URL}/api/subscriptions/momo-webhook` automatically.

**Success (200) — verified live against LMBTech:**
```json
{
  "success": true,
  "message": "Mobile Money payment request sent. Please approve it on your phone.",
  "subscription": { "id": "19", "status": "ACTIVE", "...": "..." },
  "payment": {
    "id": "39",
    "status": "PENDING",
    "payment_method": "MOMO",
    "amount": "35999",
    "gateway_reference": "SUB-39-1783637693048",
    "gateway_status": "PENDING",
    "gateway_phone": "0788123456"
  },
  "referenceId": "SUB-39-1783637693048"
}
```
Save `payment.id` (or `referenceId`) — needed to check the outcome in step 2. `gateway_reference` is our own generated id (`SUB-<paymentId>-<timestamp>`), sent to LMBTech as `reference_id` and stored for later lookups.

**Errors:**
| Status | Body | Cause |
|---|---|---|
| 400 | `{ success:false, error:"A phone number is required for Mobile Money payments." }` | missing `phone` |
| 503 | `{ success:false, error:"Mobile Money payment is temporarily unavailable...", code:"MOMO_NOT_CONFIGURED" }` | `LMBTECH_APP_KEY`/`LMBTECH_SECRET_KEY` not set |
| 502 | `{ success:false, error:"Mobile Money payment could not be initiated right now...", code:"MOMO_GATEWAY_ERROR" }` | LMBTech rejected the request |

Note: LMBTech's amount at status-check time may include their own transaction fee/markup (observed ~4% above what we sent) — this is expected and doesn't affect what we record as the subscription's price; `payment.amount` is always our authoritative billed amount.

---

## 2. Check payment status (poll this — it's the source of truth)

```
GET /api/subscriptions/momo-status?paymentId=39
Authorization: Bearer <token>
```
Call this every few seconds while showing "waiting for approval on your phone." This directly asks LMBTech for the current status and, if successful, activates the subscription right then.

**Success (200) — verified live:**
```json
{ "success": true, "data": { "status": "PENDING", "gatewayStatus": "PENDING" } }
```
or once resolved:
```json
{ "success": true, "data": { "status": "APPROVED", "gatewayStatus": "SUCCESSFUL" } }
```
```json
{ "success": true, "data": { "status": "REJECTED", "gatewayStatus": "FAILED" } }
```
- `status` is our `PaymentStatus` (`PENDING`/`APPROVED`/`REJECTED`).
- `gatewayStatus` is normalized from LMBTech's own vocabulary (`success`→`SUCCESSFUL`, `pending`→`PENDING`, `fail`/`failed`/`cancelled`→`FAILED`).
- Once `status` is no longer `PENDING`, stop polling — re-fetch `GET /api/my-subscription` to see the now-active subscription.

**Errors:** 404 if the `paymentId` doesn't belong to your organization; 401 if unauthenticated; 502 if LMBTech itself fails to respond.

---

## 3. Webhook (LMBTech's callback)

```
POST /api/subscriptions/momo-webhook
```
LMBTech POSTs here automatically when a payment resolves (the `callback_url` sent on every request). Body shape per LMBTech's docs:
```json
{ "reference_id": "SUB-39-...", "transaction_id": "TXN-...", "status": "success", "amount": "35999.00", "payment_method": "MTN_MOMO_RWA", "payer_phone": "+250780000000" }
```
This route requires no auth (LMBTech can't send a bearer token) — it's safe because it can only ever affect a payment whose `gateway_reference` already exists in our database as a `PENDING` MoMo payment; an unrecognized reference is a no-op. Responds in LMBTech's expected shape: `{ "status": true, "message": "...", "site_url": "..." }`.

**Do not rely on the webhook alone** — always implement the polling in step 2 as the guaranteed path; treat the webhook purely as a latency improvement.

---

## Notes

- **Only MOMO changed.** `CASH`/`CARD`/`BANK_TRANSFER` still auto-approve instantly (those aren't real gateway calls either — for staff manually recording an already-completed offline payment). `MANUAL_INVOICE` still requires admin approval via `POST /api/admin/subscriptions/approve`. LMBTech also supports Card payments (with a redirect flow) — not yet wired into the subscription flow, only MOMO is at this time.
- A payment can only be resolved once — if the poll and the webhook both fire, whichever arrives first wins and the second is a no-op (checked via `PaymentStatus !== PENDING`).
- `gateway_reference` is unique per payment and is what you'd use to reconcile against LMBTech's own dashboard/records.
- Client for this integration: `src/services/lmbtech.service.ts`. Error classification lives in `src/lib/api-error.ts` (`LmbtechConfigError` → 503, `LmbtechGatewayError` → 502).
