/**
 * EBM (Rwanda Revenue Authority Electronic Billing Machine) configuration.
 *
 * ALL RRA-specific config lives here in one clearly named place. Swapping the
 * mock provider for the real RRA API later is a config + adapter change only —
 * no calling code changes.
 *
 * To go live: set EBM_PROVIDER=rra and fill in the RRA_* values from the .env,
 * then implement RraEbmProvider (see ebm.provider.ts).
 */
export const ebmConfig = {
  /** "mock" (default, returns realistic fake fiscal data) or "rra" (real API). */
  provider: (process.env.EBM_PROVIDER || 'mock') as 'mock' | 'rra',

  rra: {
    // >>> REAL RRA API CONFIG GOES HERE <<<
    // These are read from env so credentials never live in source.
    baseUrl: process.env.RRA_EBM_URL || '', // e.g. https://ebm.rra.gov.rw/api
    apiKey: process.env.RRA_EBM_API_KEY || '',
    // The taxpayer's TIN and the device/SDC serial issued by RRA.
    tin: process.env.RRA_TIN || '',
    sdcId: process.env.RRA_SDC_ID || '',
    deviceSerial: process.env.RRA_DEVICE_SERIAL || '',
  },

  /** Default VAT rate applied to VAT-inclusive Rwandan sales (18%). */
  defaultVatRate: Number(process.env.EBM_VAT_RATE || 18),
}
