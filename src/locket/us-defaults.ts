// US-001: US defaults shared by the server and the screens. Required attachments
// per request type, the governing-law choices, and amounts in another currency:
// the original amount is kept and its USD equivalent is the amount times a rate a
// person records (USD per one unit), rounded half up to the cent. Locket fetches
// no exchange rate and never claims one is a market rate.

/** Decided default: attachments each request type must carry before review. */
export const defaultRequirements: Record<string, string[]> = {
  customer: ['Statement of work or order form'],
  supplier: ['Certificate of insurance', 'Form W-9'],
  amendment: ['Signed parent agreement'],
  order_form: [],
  nda: [],
  other: [],
}

/** Governing-law choices: the fifty states and the District of Columbia; any other jurisdiction is typed. */
export const usJurisdictions = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const

/** A recorded rate: USD per one unit of the other currency, a positive decimal with up to six places. */
export const ratePattern = /^\d{1,6}(\.\d{1,6})?$/
const micro = (rate: string) => {
  const [whole, frac = ''] = rate.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))
}
/** USD cents for an amount in hundredths of another currency at a recorded rate, rounded half up. */
export function usdCents(originalCents: number, rate: string): number {
  return Number((BigInt(originalCents) * micro(rate) + 500_000n) / 1_000_000n)
}
