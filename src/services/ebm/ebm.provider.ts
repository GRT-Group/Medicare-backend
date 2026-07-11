/**
 * EbmProvider — the single internal interface for RRA EBM fiscalization.
 *
 * Every part of the backend that needs an EBM invoice calls
 * `getEbmProvider().fiscalize(...)`. No other service talks to an EBM endpoint
 * directly. Today this resolves to MockEbmProvider; when the real RRA API is
 * ready, implement RraEbmProvider and flip EBM_PROVIDER=rra in config — nothing
 * else changes.
 */
import { ebmConfig } from './ebm.config'

export type EbmLineItem = {
  name: string
  quantity: number
  unit_price: number
  /** VAT rate for this line, e.g. 18. */
  tax_rate?: number
}

export type EbmFiscalizeInput = {
  organization_id: string
  invoice_number: string
  customer_name?: string
  customer_tin?: string
  items: EbmLineItem[]
  total_amount: number
  /** Payment method as recorded on the sale (CASH/MOMO/BANK_TRANSFER/CREDIT). */
  payment_method: string
}

export type EbmFiscalizeResult = {
  success: boolean
  /** RRA fiscal receipt/invoice number (the "signed" invoice id). */
  ebm_invoice_number: string | null
  /** Everything the receipt printer / frontend needs to render a fiscal receipt. */
  receipt_data: {
    sdc_id: string
    receipt_number: string
    internal_data: string
    receipt_signature: string
    qr_code_data: string
    vat_amount: number
    total_amount: number
    fiscalized_at: string
  } | null
  error?: string
}

export interface EbmProvider {
  fiscalize(input: EbmFiscalizeInput): Promise<EbmFiscalizeResult>
}

/**
 * MockEbmProvider — realistic stand-in used until the real RRA API is connected.
 * Returns believable fake fiscal invoice numbers, QR/receipt data and signatures
 * so the entire POS -> EBM -> receipt flow can be exercised end-to-end today.
 */
export class MockEbmProvider implements EbmProvider {
  async fiscalize(input: EbmFiscalizeInput): Promise<EbmFiscalizeResult> {
    // Compute VAT (VAT-inclusive: vat = total * rate / (100 + rate)).
    const rate = ebmConfig.defaultVatRate
    const vatAmount = Number(((input.total_amount * rate) / (100 + rate)).toFixed(2))

    const now = new Date()
    const stamp = now.getTime().toString().slice(-9)
    const receiptNumber = `${stamp}/${Math.floor(Math.random() * 9000 + 1000)}`
    const sdcId = ebmConfig.rra.sdcId || `SDC${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`
    // A deterministic-looking fake signature/internal-data block.
    const sig = Buffer.from(`${input.invoice_number}:${input.total_amount}:${stamp}`)
      .toString('base64')
      .replace(/[^A-Z0-9]/gi, '')
      .slice(0, 16)
      .toUpperCase()
    const internal = sig.match(/.{1,4}/g)!.join('-')

    const ebmInvoiceNumber = `RRA-${now.getFullYear()}-${stamp}`
    const qr = `https://ebm.rra.gov.rw/verify?rcpt=${receiptNumber}&tin=${ebmConfig.rra.tin || 'TESTTIN'}&sig=${sig}`

    return {
      success: true,
      ebm_invoice_number: ebmInvoiceNumber,
      receipt_data: {
        sdc_id: sdcId,
        receipt_number: receiptNumber,
        internal_data: internal,
        receipt_signature: sig,
        qr_code_data: qr,
        vat_amount: vatAmount,
        total_amount: input.total_amount,
        fiscalized_at: now.toISOString(),
      },
    }
  }
}

/**
 * RraEbmProvider — placeholder for the real RRA EBM integration.
 *
 * >>> REAL API CALL REPLACES THE MOCK HERE <<<
 * When RRA credentials are available:
 *   1. POST the invoice payload to `${ebmConfig.rra.baseUrl}/...` with the
 *      apiKey / TIN / SDC id from ebmConfig.rra.
 *   2. Map RRA's response (fiscal receipt number, signature, QR, VAT) into
 *      EbmFiscalizeResult below.
 *   3. Set EBM_PROVIDER=rra so getEbmProvider() returns this class.
 * The rest of the backend (SaleService, POS route) needs no changes.
 */
export class RraEbmProvider implements EbmProvider {
  async fiscalize(_input: EbmFiscalizeInput): Promise<EbmFiscalizeResult> {
    // Intentionally not implemented until the real RRA API is available.
    // Fails closed so a misconfigured "rra" mode never silently skips fiscalization.
    return {
      success: false,
      ebm_invoice_number: null,
      receipt_data: null,
      error: 'RRA EBM provider not yet implemented. Configure and implement RraEbmProvider before setting EBM_PROVIDER=rra.',
    }
  }
}

let _provider: EbmProvider | null = null

/** Returns the configured EBM provider singleton. */
export function getEbmProvider(): EbmProvider {
  if (_provider) return _provider
  _provider = ebmConfig.provider === 'rra' ? new RraEbmProvider() : new MockEbmProvider()
  return _provider
}
