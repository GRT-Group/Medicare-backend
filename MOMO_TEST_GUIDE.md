# Quick Test Guide — MoMo Subscription Payment

Copy-paste ready requests to test the LMBTech MoMo integration right now against the live dev server.

**Server:** `http://localhost:3000`

**Test token** (org 4 / FONI AGROVET, admin role, valid 24h from generation):
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjMiLCJlbWFpbCI6Inl1bXZhZ3VzZW5nYTIwMDBAZ21haWwuY29tIiwicm9sZV9pZCI6IjIiLCJvcmdhbml6YXRpb25faWQiOiI0IiwiaWF0IjoxNzgzNjM4MTc4LCJleHAiOjE3ODM3MjQ1Nzh9.x8PN-4bajMWqHVREpFn_BWm99lmhe0yUljwxxyak3LM
```
This is a **dev-only test token** signed with your local `JWT_SECRET` — it does not come from a real login and won't work against any other environment. Generate a fresh one anytime with:
```bash
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
console.log(jwt.sign({ id: '3', email: 'yumvagusenga2000@gmail.com', role_id: '2', organization_id: '4' }, process.env.JWT_SECRET, { expiresIn: '24h' }));
"
```

**Real plan IDs you can use** (`planId`): `1` = Standard (35999 RWF), `2` = Premium (59999), `3` = Max (89999).

---

## 1. Check current subscription status

```bash
curl -X GET "http://localhost:3000/api/my-subscription" \
  -H "Authorization: Bearer <TOKEN>"
```

## 2. Start a MoMo payment

```bash
curl -X POST "http://localhost:3000/api/my-subscription" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": 1,
    "months": 1,
    "paymentMethod": "MOMO",
    "phone": "0788123456"
  }'
```
Response includes `payment.id` and `referenceId` — save both.

**To actually see it auto-resolve to success**, use LMBTech's documented sandbox test number instead of a random one:
```bash
curl -X POST "http://localhost:3000/api/my-subscription" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": 1,
    "months": 1,
    "paymentMethod": "MOMO",
    "phone": "+250780000000"
  }'
```

## 3. Poll payment status (repeat every few seconds)

```bash
curl -X GET "http://localhost:3000/api/subscriptions/momo-status?paymentId=<PAYMENT_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```
`data.status` becomes `APPROVED` (success) or `REJECTED` (failed) once resolved — stop polling then and re-check step 1.

## 4. Regression check — a normal (non-MoMo) payment still works

```bash
curl -X POST "http://localhost:3000/api/my-subscription" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"planId": 1, "months": 1, "paymentMethod": "CASH"}'
```
This activates immediately (no gateway involved) — useful to confirm the rest of the subscription system is unaffected.

---

## From your frontend (JavaScript)

```js
const API_BASE = "http://localhost:3000";

async function payWithMomo(token, { planId, months, phone }) {
  const res = await fetch(`${API_BASE}/api/my-subscription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ planId, months, paymentMethod: "MOMO", phone }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data; // { payment: { id }, referenceId, ... }
}

async function pollMomoStatus(token, paymentId, { onSuccess, onFailed, intervalMs = 4000 }) {
  const timer = setInterval(async () => {
    const res = await fetch(`${API_BASE}/api/subscriptions/momo-status?paymentId=${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { data } = await res.json();
    if (data.status === "APPROVED") { clearInterval(timer); onSuccess?.(); }
    if (data.status === "REJECTED") { clearInterval(timer); onFailed?.(); }
  }, intervalMs);
  return () => clearInterval(timer); // call to stop polling manually
}

// Usage:
// const { payment } = await payWithMomo(token, { planId: 1, months: 1, phone: "0788123456" });
// pollMomoStatus(token, payment.id, {
//   onSuccess: () => alert("Subscription activated!"),
//   onFailed: () => alert("Payment failed, please try again."),
// });
```

Full endpoint reference: [MOMO_SUBSCRIPTION_PAYMENT_API.md](MOMO_SUBSCRIPTION_PAYMENT_API.md)
