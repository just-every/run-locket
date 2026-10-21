// Declarative forms: bounded, typed questions and ordered, deterministic routing.
import { bool, date, fail, list, money, object, oneOf, text } from './model'

export const formKinds = ['text','number','money','date','pick_list','person','counterparty','file'] as const
export const formTypes = ['customer','supplier','nda','amendment','order_form','other'] as const
export interface Condition { field: string; op: 'eq'|'gt'|'gte'|'lt'|'lte'; value: string }
export interface FormField { key: string; label: string; kind: typeof formKinds[number]; required: boolean; options: string[]; when?: Condition[] }
export interface FormRoute { ownerId: string; reviewerId: string; approvalRole: 'approver'|'counsel' }
export interface FormDefinition {
  name: string; type: string; fields: FormField[]; requirements: string[]
  launch: { roles: string[]; audienceIds: string[] }; defaultRoute: FormRoute
  rules: { name: string; when: Condition[]; route: FormRoute; requirements: string[] }[]
}
const strings = (p: Record<string,unknown>, key: string, max = 30) => [...new Set(list(p,key,max).map(x => text({x},'x',200)))]
const route = (input: unknown): FormRoute => {
  const p = object(input,'route')
  return { ownerId: text(p,'ownerId',100), reviewerId: text(p,'reviewerId',100), approvalRole: oneOf(p,'approvalRole',['approver','counsel']) }
}
const builtins = ['type','value','department','region']
function conditions(input: Record<string,unknown>, fields: FormField[]): Condition[] {
  return list(input,'when',12).map(raw => {
    const c = object(raw,'condition'), field = text(c,'field',64)
    const f = fields.find(f => f.key === field)
    if (!builtins.includes(field) && !f) fail('INVALID','A condition must name a prior question or a standard routing field.')
    if (f?.kind === 'file') fail('INVALID','File contents cannot be routing conditions.')
    const op = oneOf(c,'op',['eq','gt','gte','lt','lte'])
    let value = text(c,'value',1000)
    if (op !== 'eq' && field !== 'value' && !['number','money'].includes(f?.kind ?? '')) fail('INVALID','Ordered comparisons need a number or USD money question.')
    if (field === 'value' || f?.kind === 'money') value = (money({value},'value')! / 100).toFixed(2)
    if (f?.kind === 'number' && (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) fail('INVALID','A numeric condition needs a finite number.')
    if (f?.kind === 'number') value=String(Number(value))
    if (f?.kind === 'pick_list' && !f.options.includes(value)) fail('INVALID','Choose an option defined by the question.')
    if (f?.kind === 'date') date({value},'value')
    if (field === 'type' && !formTypes.includes(value as any)) fail('INVALID','Choose a supported agreement type.')
    return {field,op,value}
  })
}
export function formDefinition(input: unknown): FormDefinition {
  const p = object(input,'definition'), fields: FormField[] = []
  for (const raw of list(p,'fields',40)) {
    const f = object(raw,'field'), key = text(f,'key',64)
    if (!/^[a-z][a-z0-9_]*$/.test(key) || builtins.includes(key) || ['__proto__','constructor','prototype'].includes(key) || fields.some(f => f.key === key)) fail('INVALID','Question keys must be unique lowercase names, separate from standard routing fields.')
    const kind = oneOf(f,'kind',formKinds), options = strings(f,'options',40)
    if (kind === 'pick_list' && !options.length) fail('INVALID','A pick list needs options.')
    fields.push({key,label:text(f,'label',200),kind,required:bool(f,'required'),options:kind === 'pick_list' ? options : [],when:conditions(f,fields)})
  }
  const launch = object(p.launch,'launch'), roles = strings(launch,'roles',6)
  if (roles.some(r => !['owner','counsel','approver','requester'].includes(r))) fail('INVALID','Only human request-creating roles may launch a form.')
  const audienceIds = strings(launch,'audienceIds',40)
  if (!roles.length && !audienceIds.length) fail('INVALID','Choose at least one role, group or department that may launch.')
  return {name:text(p,'name',200),type:oneOf(p,'type',formTypes),fields,requirements:strings(p,'requirements'),launch:{roles,audienceIds},defaultRoute:route(p.defaultRoute),rules:list(p,'rules',30).map(raw => {
    const r=object(raw,'rule'), when=conditions(r,fields)
    if (!when.length) fail('INVALID','A routing rule needs a condition; use the default route for everything else.')
    return {name:text(r,'name',200),when,route:route(r.route),requirements:strings(r,'requirements')}
  })}
}
export function matches(when: Condition[] | undefined, answers: Record<string,unknown>): boolean {
  return (when ?? []).every(c => {
    const actual=answers[c.field]
    if (actual === undefined || actual === null || actual === '') return false
    if (c.op === 'eq') return String(actual) === c.value
    const a=Number(actual), b=Number(c.value)
    return Number.isFinite(a) && Number.isFinite(b) && ({gt:a>b,gte:a>=b,lt:a<b,lte:a<=b}[c.op])
  })
}
export function evaluateForm(def: FormDefinition, input: Record<string,unknown>, value: string | null) {
  // Only visible prior questions can influence later questions or routing.
  const answers: Record<string,unknown> = {type:def.type,...(value !== null ? {value} : {}),department:input.department ?? '',region:input.region ?? ''}
  const fields: FormField[]=[]
  for (const f of def.fields) if(matches(f.when,answers)) { fields.push(f); if(input[f.key] !== undefined) answers[f.key]=input[f.key] }
  const rule=def.rules.find(r=>matches(r.when,answers))
  return {fields,answers,route:rule?.route ?? def.defaultRoute,requirements:[...new Set([...def.requirements,...(rule?.requirements ?? [])])],matchedRule:rule?.name ?? null}
}
