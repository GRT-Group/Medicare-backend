/**
 * LMBTech Payment Gateway client (Link Mobile Technology Ltd) —
 * https://pay.lmbtech.rw. Handles Mobile Money (MTN MOMO) and Card
 * collections behind one API, replacing a prior direct-MTN-API attempt:
 * this is the gateway this organization actually holds credentials for.
 *
 * Auth: Basic <base64(app_key:secret_key)> on every request (per LMBTech's
 * "PAYMENT API Documentation guide").
 */

export class LmbtechConfigError extends Error {}

/**
 * The gateway rejected/failed the request, or its response didn't match the
 * documented shape — as opposed to our own request validation failing first.
 */
export class LmbtechGatewayError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message)
  }
}

function getConfig() {
  const appKey = process.env.LMBTECH_APP_KEY
  const secretKey = process.env.LMBTECH_SECRET_KEY
  const baseUrl = process.env.LMBTECH_BASE_URL || 'https://pay.lmbtech.rw/pay/config/api.php'

  if (!appKey || !secretKey) {
    throw new LmbtechConfigError(
      'LMBTech payment gateway is not configured: set LMBTECH_APP_KEY and LMBTECH_SECRET_KEY (see .env.example).'
    )
  }

  const authHeader = 'Basic ' + Buffer.from(`${appKey}:${secretKey}`).toString('base64')
  return { baseUrl, authHeader }
}

type LmbtechStatus = 'success' | 'pending' | 'fail' | 'failed' | 'cancelled'

export type LmbtechCollectResult = {
  /** Our own reference_id — echoed back by LMBTech, and the key used for status checks/callback matching. */
  referenceId: string
  /** LMBTech's immediate response status for this call (not necessarily the final outcome — poll/await the callback for that). */
  status: LmbtechStatus
  /** Only present for card payments: redirect the customer here to complete payment. */
  redirectUrl?: string
}

/**
 * Initiates a collection (Mobile Money "Request to Pay" or Card).
 * For MOMO: MTN pushes an approval prompt to `payerPhone`; the immediate
 * response is "success"/"pending"/"fail" per LMBTech's docs, but the
 * authoritative outcome is the callback (see momo-webhook route) or
 * checkStatus below.
 * For Card: the response has no final status — redirect the customer to
 * `redirectUrl` to complete payment on LMBTech's hosted card page.
 */
export async function initiateCollection(params: {
  email: string
  name: string
  paymentMethod: 'MTN_MOMO_RWA' | 'card'
  amount: number
  servicePaid: string
  referenceId: string
  callbackUrl: string
  payerPhone?: string // required for MTN_MOMO_RWA
  cardRedirectUrl?: string // required for card
}): Promise<LmbtechCollectResult> {
  const cfg = getConfig()

  const body: Record<string, unknown> = {
    email: params.email,
    name: params.name,
    payment_method: params.paymentMethod,
    amount: params.amount,
    service_paid: params.servicePaid,
    reference_id: params.referenceId,
    callback_url: params.callbackUrl,
    action: 'pay',
  }
  if (params.paymentMethod === 'MTN_MOMO_RWA') body.payer_phone = params.payerPhone
  if (params.paymentMethod === 'card') body.card_redirect_url = params.cardRedirectUrl

  const res = await fetch(cfg.baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': cfg.authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new LmbtechGatewayError(`LMBTech returned a non-JSON response (${res.status}): ${text.slice(0, 500)}`, res.status)
  }

  if (json.status === 'fail' && !res.ok) {
    throw new LmbtechGatewayError(json.message || 'LMBTech rejected the payment request', res.status)
  }

  return {
    referenceId: json.data?.reference_id || params.referenceId,
    status: json.status,
    redirectUrl: json.data?.redirect_url,
  }
}

export type LmbtechStatusResult = {
  referenceId: string
  transactionId?: string
  amount?: string
  /** LMBTech's raw status string — not narrowed to LmbtechStatus since the live API's exact vocabulary isn't fully guaranteed by the docs; pass through normalizeLmbtechStatus(). */
  status: string
  paymentMethod?: string
  paymentDate?: string
}

/**
 * Authoritative status check by reference_id — call this (or trust the
 * callback) to find out the real outcome after initiateCollection.
 */
export async function checkStatus(referenceId: string): Promise<LmbtechStatusResult> {
  const cfg = getConfig()

  const url = new URL(cfg.baseUrl)
  url.searchParams.set('reference_id', referenceId)

  const res = await fetch(url.toString(), {
    headers: { 'Authorization': cfg.authHeader },
  })

  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new LmbtechGatewayError(`LMBTech returned a non-JSON response (${res.status}): ${text.slice(0, 500)}`, res.status)
  }

  if (res.status === 404) {
    throw new LmbtechGatewayError(`No LMBTech transaction found for reference ${referenceId}`, 404)
  }
  if (json.status === 'fail' && !res.ok) {
    throw new LmbtechGatewayError(json.message || 'LMBTech status check failed', res.status)
  }

  // LMBTech's documented example nests the transaction under `data`, but the
  // live API returns it flat on the root object — accept either shape so a
  // future doc/behavior fix on their end doesn't silently break us again.
  const data = json.data && typeof json.data === 'object' ? json.data : json
  const status = data.status
  if (typeof status !== 'string') {
    throw new LmbtechGatewayError(`LMBTech status check response had no recognizable status field: ${JSON.stringify(json).slice(0, 300)}`)
  }

  return {
    referenceId: data.reference_id || referenceId,
    transactionId: data.transaction_id,
    amount: data.amount,
    status,
    paymentMethod: data.payment_method,
    paymentDate: data.payment_date,
  }
}

/**
 * Normalizes LMBTech's status vocabulary (success/pending/fail/failed/cancelled)
 * down to the three states the rest of the app cares about.
 */
export function normalizeLmbtechStatus(status: string): 'PENDING' | 'SUCCESSFUL' | 'FAILED' {
  const s = status.toLowerCase()
  if (s === 'success') return 'SUCCESSFUL'
  if (s === 'pending') return 'PENDING'
  return 'FAILED' // fail | failed | cancelled
}
