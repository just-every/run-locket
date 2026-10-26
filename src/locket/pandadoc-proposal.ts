import type { Bindings } from '../auth.server'
import { encodeBase64 } from './artifacts'
import { readablePages } from './execution-comparison'
import { canonical, fail, list, object, text } from './model'
import { platterPricing } from './proposal-pricing'

const origin = 'https://api.pandadoc.com'
const pricingError = (message: string): never => fail('PROPOSAL_PRICING', message, 409)

function decimal(value: unknown, places: number, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') pricingError(`PandaDoc ${label} must be an exact nonnegative decimal.`)
  const source = String(value)
  if (!/^\d{1,12}(?:\.\d{1,12})?$/.test(source)) pricingError(`PandaDoc ${label} must be an exact nonnegative decimal.`)
  const [whole, fraction = ''] = source.split('.')
  const trimmed = fraction.replace(/0+$/, '')
  if (trimmed.length > places) pricingError(`PandaDoc ${label} has unsupported precision.`)
  return whole + (trimmed ? '.' + trimmed : '')
}

function cents(value: unknown, label: string): number {
  const [whole, fraction = ''] = decimal(value, 2, label).split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000) pricingError(`PandaDoc ${label} exceeds the supported amount.`)
  return amount
}

function noAdjustments(row: Record<string, unknown>) {
  for (const key of ['discount', 'tax', 'fee', 'tax_first', 'tax_second', 'discounts', 'taxes', 'fees', 'multipliers']) {
    const value = row[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      const adjustment = object(value)
      if (!Object.keys(adjustment).length) continue
      if ('value' in adjustment && cents(adjustment.value, key) === 0 && Object.keys(adjustment).every(k => ['value', 'type', 'name', 'is_global'].includes(k))) continue
    } else if ((typeof value === 'string' || typeof value === 'number') && cents(value, key) === 0) continue
    pricingError('PandaDoc taxes, fees, multipliers and discounts require an explicit supported mapping before import.')
  }
}

function selected(item: Record<string, unknown>): boolean {
  const options = item.options == null ? {} : object(item.options, 'PandaDoc item options')
  for (const key of ['optional', 'optional_selected', 'multichoice_enabled', 'multichoice_selected', 'qty_editable']) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') pricingError('PandaDoc selection flags must be explicit booleans.')
  }
  if (options.multichoice_enabled === true || options.multichoice_selected === true) pricingError('PandaDoc multiple-choice sections require a supported section mapping before import.')
  if (options.optional === true) {
    if (typeof options.optional_selected !== 'boolean') pricingError('PandaDoc optional rows must retain their explicit selected state.')
    return options.optional_selected === true
  }
  return true
}

function pricingTables(detail: Record<string, unknown>, currency: string, totalCents: number) {
  // Document Details returns flat pricing table items; nested sections and rows belong to document creation.
  const pricing = object(detail.pricing, 'PandaDoc pricing')
  if (list(pricing, 'quotes', 100).length) pricingError('PandaDoc quote-builder pricing requires a supported mapping before import.')
  noAdjustments(pricing)
  const tables = list(pricing, 'tables', 100)
  if (!tables.length) pricingError('PandaDoc must return its completed pricing tables and item amounts.')
  let total = 0, count = 0
  const normalized: { lines: { name: string; description: string; quantity: string; unitPrice: string; grossCents: number; lineTotalCents: number }[] }[] = []
  for (const entry of tables) {
    const table = object(entry, 'PandaDoc pricing table')
    if (typeof table.is_included_in_total !== 'boolean') pricingError('PandaDoc tables must explicitly state whether they contribute to the total.')
    if (!table.is_included_in_total) continue
    if (table.currency !== currency) pricingError('Each included PandaDoc table must match the document currency.')
    noAdjustments(table)
    if (table.options != null) noAdjustments(object(table.options, 'PandaDoc table options'))
    const items = list(table, 'items', 100), lines = []
    let subtotal = 0
    for (const entry of items) {
      const item = object(entry, 'PandaDoc pricing item')
      if (!selected(item)) continue
      noAdjustments(item)
      const quantity = decimal(item.qty, 3, 'quantity'), unitPrice = decimal(item.price, 2, 'unit price')
      if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) pricingError('PandaDoc quantities must be positive with at most three decimal places.')
      const unitCents = cents(unitPrice, 'unit price'), net = cents(item.subtotal, 'item subtotal')
      const [whole, fraction = ''] = quantity.split('.')
      const gross = Number(((BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))) * BigInt(unitCents) + 500n) / 1000n)
      if (!Number.isSafeInteger(gross) || gross !== net) pricingError('PandaDoc item subtotal must match its quantity and unit price without inferred adjustments.')
      if (item.sale_price != null && cents(item.sale_price, 'sale price') !== unitCents) pricingError('PandaDoc sale-price adjustments require a supported mapping before import.')
      if (item.currency != null && item.currency !== currency) pricingError('PandaDoc item currencies must match the document currency.')
      const description = item.description == null ? '' : typeof item.description === 'string' ? item.description : pricingError('PandaDoc item descriptions must be text.')
      lines.push({ name: text(item, 'name', 500), description, quantity, unitPrice, grossCents: gross, lineTotalCents: net })
      subtotal += net
      if (++count > 100) pricingError('Import supports at most one hundred selected PandaDoc items.')
    }
    if (cents(table.total, 'table total') !== subtotal) pricingError('PandaDoc selected item amounts must match their table total.')
    if (table.summary != null) {
      const summary = object(table.summary, 'PandaDoc table summary')
      noAdjustments(summary)
      for (const key of ['subtotal', 'total']) if (summary[key] != null && cents(summary[key], key) !== subtotal) pricingError('PandaDoc table summary must match its selected item amounts.')
    }
    total += subtotal
    normalized.push({ lines })
  }
  if (!count || total !== totalCents || pricing.total != null && cents(pricing.total, 'pricing total') !== total) pricingError('PandaDoc included tables must exactly match the document grand total.')
  return normalized
}

async function sourceDocument(id: string, token: string, customerName: string) {
  let bytes: Uint8Array
  try {
    const response = await fetch(`${origin}/public/v1/documents/${encodeURIComponent(id)}/download-protected`, {
      redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { authorization: `API-Key ${token}`, accept: 'application/pdf' },
    })
    if (response.status !== 200) fail('PANDADOC_READ', `PandaDoc completed-document download returned HTTP ${response.status}.`, 502)
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    fail('PANDADOC_READ', 'PandaDoc completed document could not be retrieved.', 502)
  }
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) fail('PROPOSAL_SOURCE', 'The completed PandaDoc PDF must fit the five megabyte source-file limit.', 409)
  const pages = await readablePages(bytes)
  if (!pages) fail('PROPOSAL_SOURCE', 'The completed PandaDoc PDF must contain readable text on every page before its terms can be imported.', 409)
  const terms = pages.join('\n'), normalized = (value: string) => value.replace(/\s+/gu, ' ').trim()
  if (!normalized(terms).includes(normalized(customerName))) fail('PROPOSAL_CUSTOMER', 'The explicitly mapped customer name must appear in the completed PandaDoc document.', 409)
  return { terms, rawProviderPdfBase64: encodeBase64(bytes) }
}

export async function pandadocProposal(env: Bindings, p: Record<string, unknown>) {
  if (p.consent !== true) fail('CONSENT', 'Confirm importing this completed proposal and the explicit customer mapping.')
  const id = text(p, 'proposalId', 100), clientName = text(p, 'customerName', 200)
  const recipientIds = list(p, 'completedRecipientIds', 100).map(value => text({ id: value }, 'id', 100))
  if (!recipientIds.length || new Set(recipientIds).size !== recipientIds.length) fail('PROPOSAL_CUSTOMER', 'Explicitly select unique completed customer recipient IDs.')
  const token = (env as unknown as Record<string, unknown>).PANDADOC_API_KEY
  if (typeof token !== 'string' || !token.trim()) fail('HANDOFF_CONFIG', 'Configure the PandaDoc API key in private installation bindings.', 503)
  let rawProviderBody: string
  try {
    const response = await fetch(`${origin}/public/v1/documents/${encodeURIComponent(id)}/details`, {
      redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { authorization: `API-Key ${token}`, accept: 'application/json' },
    })
    if (!response.ok) fail('PANDADOC_READ', `PandaDoc details returned HTTP ${response.status}.`, 502)
    rawProviderBody = await response.text()
    if(new TextEncoder().encode(rawProviderBody).length>262144)fail('PANDADOC_READ','The PandaDoc details exceed the supported retained source size.',502)
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    fail('PANDADOC_READ', 'PandaDoc document details could not be retrieved.', 502)
  }
  let detail: Record<string, unknown>
  try { detail = object(JSON.parse(rawProviderBody), 'PandaDoc document details') }
  catch { fail('PANDADOC_READ', 'PandaDoc returned invalid document details.', 502) }
  if (detail.id !== id || detail.status !== 'document.completed') fail('NOT_ACCEPTED', 'PandaDoc must show this exact document completed.', 409)
  const recipients = list(detail, 'recipients', 100).map(value => object(value, 'PandaDoc recipient'))
  const completedRecipients = recipientIds.map(id => {
    const matches = recipients.filter(recipient => recipient.id === id)
    if (matches.length !== 1 || matches[0].has_completed !== true || matches[0].recipient_type !== 'signer') fail('NOT_ACCEPTED', 'Each selected customer recipient must be one completed PandaDoc signer.', 409)
    return matches[0]
  })
  const modified = text(detail, 'content_date_modified', 64), revision = Date.parse(modified)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(modified) || !Number.isSafeInteger(revision) || revision <= 0) fail('PANDADOC_REVISION', 'PandaDoc must return a valid content modification timestamp.', 409)
  const grandTotal = object(detail.grand_total, 'PandaDoc grand total'), currency = text(grandTotal, 'currency', 3)
  if (!/^[A-Z]{3}$/.test(currency)) pricingError('PandaDoc must name a three-letter currency.')
  const totalCents = cents(grandTotal.amount, 'grand total'), tables = pricingTables(detail, currency, totalCents)
  const acceptance = { revision, optionId: 'completed-document', currency, totalCents, completedAt: detail.date_completed, completedRecipientIds: recipientIds, completedRecipients, customerMapping: { customerName: clientName } }
  const source = await sourceDocument(id, token, clientName)
  const recheck=await fetch(`${origin}/public/v1/documents/${encodeURIComponent(id)}/details`,{redirect:'manual',signal:AbortSignal.timeout(15_000),headers:{authorization:`API-Key ${token}`,accept:'application/json'}})
  if(!recheck.ok||canonical(await recheck.json())!==canonical(detail))fail('PANDADOC_REVISION','The accepted source changed while its completed PDF was being read. Review the current revision before import.',409)
  const proposal = {
    id, revision, title: text(detail, 'name', 200), clientName, currency, scope: '', ...source, acceptance,
    options: [{ id: acceptance.optionId, cents: totalCents, tables }],
    provider: 'pandadoc', rawProviderDetail: detail, rawProviderBody,
  }
  return { origin, id, revision, proposal, pricing: platterPricing(proposal, p.usdRate) }
}
