import { badRequest } from '@/lib/api-error'

/**
 * Shared, tolerant parsing for sale payloads — used by both POST /api/sales
 * and POST /api/agrovet/pos/sale so every POS/frontend naming convention
 * (camelCase, snake_case, display labels like "Bank") is accepted by both
 * endpoints, and bad input always becomes a readable 400 instead of a 500.
 */

// Maps the POS UI's display labels (and their upper-cased forms) to the
// Prisma PaymentMethod enum values, since "Bank" -> "BANK" isn't a valid
// member (it's BANK_TRANSFER) and naive .toUpperCase() alone would 500 on it.
const PAYMENT_METHOD_MAP: Record<string, string> = {
  CASH: 'CASH',
  CREDIT: 'CREDIT',
  MOMO: 'MOMO',
  MOBILE_MONEY: 'MOMO',
  CARD: 'CARD',
  BANK: 'BANK_TRANSFER',
  BANK_TRANSFER: 'BANK_TRANSFER',
  MANUAL_INVOICE: 'MANUAL_INVOICE',
}

export const PAYMENT_METHODS_HINT = 'CASH, CREDIT, MOMO, CARD, BANK_TRANSFER or MANUAL_INVOICE'

/** Returns the canonical PaymentMethod enum value, or null if unrecognized. */
export function normalizePaymentMethod(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_')
  return PAYMENT_METHOD_MAP[key] || null
}

export type ParsedSaleItem = { product_id: bigint; batch_id?: bigint; quantity: number; unit_price?: number }

/**
 * Parse one POS line item, tolerating every naming the frontends use:
 * product_id/productId/id, batch_id/batchId, quantity/qty,
 * unit_price/unitPrice/price.
 * unit_price comes back undefined when omitted — the caller decides whether
 * to auto-price or reject. batch_id is optional: when present the sale must
 * deduct that specific batch (the one the cashier picked on screen).
 * Throws a 400-tagged error with a precise, user-fixable message on bad input.
 */
export function parseSaleItem(raw: any, index: number): ParsedSaleItem {
  const label = `items[${index}]`
  const productIdRaw = raw?.product_id ?? raw?.productId ?? raw?.id
  if (productIdRaw === undefined || productIdRaw === null || productIdRaw === '') {
    throw badRequest(`${label}: product_id is required`)
  }
  let productId: bigint
  try {
    productId = BigInt(productIdRaw)
  } catch {
    throw badRequest(`${label}: product_id must be a numeric ID (got "${productIdRaw}")`)
  }

  const quantity = Number(raw?.quantity ?? raw?.qty)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest(`${label}: quantity must be a positive whole number`)
  }

  const priceRaw = raw?.unit_price ?? raw?.unitPrice ?? raw?.price ?? raw?.selling_price ?? raw?.sellingPrice
  let unitPrice: number | undefined
  if (priceRaw !== undefined && priceRaw !== null && priceRaw !== '') {
    unitPrice = Number(priceRaw)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw badRequest(`${label}: unit_price must be a non-negative number`)
    }
  }

  // Enforce Backend FIFO/FEFO: Ignore any batchId sent by the frontend 
  // so the backend services always automatically select the oldest batches.
  const batchId = undefined;

  return { product_id: productId, batch_id: batchId, quantity, unit_price: unitPrice }
}

/**
 * Parse an optional entity ID that may arrive as a string or number under
 * any key. Returns undefined for absent/empty values; throws a 400-tagged
 * error when present but not numeric.
 */
export function parseOptionalId(value: unknown, field: string): bigint | undefined {
  if (value === undefined || value === null || value === '') return undefined
  try {
    return BigInt(value as any)
  } catch {
    throw badRequest(`${field} must be a numeric ID (got "${value}")`)
  }
}
