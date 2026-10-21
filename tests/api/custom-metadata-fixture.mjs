import { file, pdf } from './files.mjs'
export const metadataText = 'Data processing: yes. Cost center: Operations. The budget is 1200.50 USD.'
export const fieldSpec = (name, kind, extra = {}) => ({ name, kind, agreementTypes: ['other'], helpText: 'Record the value from the agreement.', requiredStages: [], editRoles: ['owner', 'counsel', 'approver', 'requester'], options: [], ...extra })
export async function metadataFields(owner, suffix = '') {
  const yes = await owner.command('field.save', fieldSpec('Data processing' + suffix, 'yes_no'))
  const cost = await owner.command('field.save', fieldSpec('Cost center' + suffix, 'pick_list', { options: ['Operations', 'Finance'], requiredStages: ['approved'] }))
  return { yes: yes.id, cost: cost.id }
}
export async function metadataAgreement(owner, { title = 'Processing agreement', values = {}, restricted = false, parentId } = {}) {
  const a = await owner.command('request.create', { title, type: 'other', party: { name: title + ' LLC', kind: 'supplier' }, file: file(title + '.pdf', pdf(metadataText)), text: metadataText, customValues: values, restricted, ...(parentId ? { parentId, relation: 'amends' } : {}) })
  for (const requirement of (await owner.state()).requirements.filter(r => r.agreement_id === a.id)) await owner.command('requirement.waive', { agreementId: a.id, requirementId: requirement.id, reason: 'Document supplied with this request.' })
  return a
}
export const customKey = id => `custom:${id}`
export const customDefinition = ({ yes, cost }, query = '') => ({ query, filters: [{ field: customKey(yes), operator: 'eq', value: 'yes' }, { field: customKey(cost), operator: 'eq', value: 'Operations' }], sort: { field: customKey(cost), direction: 'asc' }, columns: [customKey(cost), 'title', customKey(yes)] })
