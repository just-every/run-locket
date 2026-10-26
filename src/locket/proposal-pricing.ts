import { fail, integer, money, text } from './model'
import { ratePattern, usdCents } from './us-defaults'

const cents = (value: unknown) => integer({ value }, 'value', 0, 1_000_000_000)
const amount = (value: number) => (value / 100).toFixed(2)

/** Allocate an accepted package total across its lines, preserving every cent. */
function allocate(weights: number[], total: number) {
  const sum = weights.reduce((n, value) => n + BigInt(value), 0n)
  if (sum === 0n) fail('PROPOSAL_PRICING', 'The accepted proposal needs a positive quoted subtotal.', 409)
  const rows = weights.map((value, index) => ({ index, net: Number(BigInt(value) * BigInt(total) / sum), remainder: BigInt(value) * BigInt(total) % sum }))
  let left = total - rows.reduce((n, row) => n + row.net, 0)
  for (const row of [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) if (left-- > 0) row.net++
  return rows.map(row => row.net)
}

export function platterPricing(proposal: any, usdRate: unknown) {
  const acceptance = proposal.acceptance, option = proposal.options?.find((row: any) => row.id === acceptance.optionId)
  if (!option) fail('PROPOSAL_PRICING', 'The accepted option must still exist.', 409)
  const currency = text(proposal, 'currency', 3)
  if (!/^[A-Z]{3}$/.test(currency) || currency !== acceptance.currency) fail('PROPOSAL_PRICING', 'The accepted currency must match the quoted currency.', 409)
  let rate: string | undefined
  if (currency !== 'USD') {
    rate = text({ usdRate }, 'usdRate', 13)
    if (!ratePattern.test(rate) || /^0*(\.0*)?$/.test(rate)) fail('PROPOSAL_PRICING', 'Record a positive USD-per-unit exchange rate; Locket never fetches one.', 409)
  }
  const sourceLines = (option.tables ?? []).flatMap((table: any) => table.lines ?? []).map((line: any) => {
    const quantity = String(line.quantity), unitCents = money({ price: line.unitPrice }, 'price'), net = cents(line.lineTotalCents)
    if (!/^\d{1,7}(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || unitCents === null) fail('PROPOSAL_PRICING', 'Use positive quoted quantities with at most three decimal places and exact unit prices.', 409)
    const [whole, fraction = ''] = quantity.split('.')
    const gross = Number(((BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))) * BigInt(unitCents) + 500n) / 1000n)
    if (!Number.isSafeInteger(gross) || gross > 1_000_000_000 || net > gross || line.grossCents !== undefined && cents(line.grossCents) !== gross) fail('PROPOSAL_PRICING', 'Quoted quantities, gross prices and net prices must reconcile.', 409)
    return { description: text({ description: [line.name, line.description].filter(Boolean).join(' - ') }, 'description', 500), quantity, unitCents, grossCents: gross, totalCents: net }
  })
  const choices = acceptance.selection?.items ?? [], seen = new Set<string>()
  if (!Array.isArray(choices)) fail('PROPOSAL_PRICING', 'Accepted optional items must be a list.', 409)
  for (const choice of choices) {
    const item = option.optionalItems?.find((row: any) => row.id === choice.id)
    if (!item || seen.has(choice.id)) fail('PROPOSAL_PRICING', 'Each accepted optional item must match one offered item.', 409)
    seen.add(choice.id)
    const quantity = integer(choice, 'quantity', cents(item.min), cents(item.max)), unitCents = cents(item.unitCents), totalCents = quantity * unitCents
    if ((!item.editable && quantity !== item.quantity) || !Number.isSafeInteger(totalCents) || choice.unitCents !== unitCents || choice.totalCents !== totalCents || choice.label !== item.label) fail('PROPOSAL_PRICING', 'The accepted optional item must retain its offered label, price and permitted quantity.', 409)
    if (quantity) sourceLines.push({ description: text({ description: item.label }, 'description', 500), quantity: String(quantity), unitCents, grossCents: totalCents, totalCents })
  }
  if (!sourceLines.length || sourceLines.length > 100) fail('PROPOSAL_PRICING', 'Import requires one to one hundred selected line items.', 409)
  const base = (option.tables ?? []).flatMap((table: any) => table.lines ?? []).reduce((n: number, line: any) => n + cents(line.lineTotalCents), 0)
  const extras = sourceLines.slice((option.tables ?? []).flatMap((table: any) => table.lines ?? []).length).reduce((n: number, line: any) => n + line.totalCents, 0)
  const gross = base + extras, discount = acceptance.selection?.discountCents ?? option.discount?.cents ?? 0, total = cents(acceptance.totalCents)
  if (!Number.isSafeInteger(gross) || gross - cents(discount) !== total || !total || acceptance.selection && (acceptance.selection.optionId !== option.id || acceptance.selection.totalCents !== total) || !acceptance.selection && option.cents !== total) fail('PROPOSAL_PRICING', 'Selected prices and the accepted package discount must exactly match the accepted total.', 409)
  // Record net bundles for quantities or discounts the native integer pricing table cannot represent directly.
  const net = allocate(sourceLines.map((line: any) => line.totalCents), total)
  const totalCents = rate ? usdCents(total, rate) : total
  if (!Number.isSafeInteger(totalCents) || totalCents > 1_000_000_000 || totalCents <= 0) fail('PROPOSAL_PRICING', 'The converted USD total exceeds the supported range.', 409)
  const converted = allocate(net, totalCents)
  const lineItems = sourceLines.map((line: any, index: number) => {
    const simple = currency === 'USD' && Number.isInteger(Number(line.quantity)) && Number(line.quantity) <= 1_000_000 && net[index] === line.grossCents
    return simple ? { description: line.description, quantity: Number(line.quantity), unitCents: line.unitCents, totalCents: net[index] } : {
      description: `${line.description} [${line.quantity} x ${currency} ${amount(line.unitCents)}; net ${currency} ${amount(net[index])}${rate ? `; recorded rate ${rate} USD per ${currency}` : ''}; quoted bundle]`, quantity: 1, unitCents: converted[index], totalCents: converted[index],
    }
  })
  return { currency, usdRate: rate, originalTotalCents: total, totalCents, sourceLines, lineItems }
}
