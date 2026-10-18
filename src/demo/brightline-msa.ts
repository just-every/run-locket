// Brightline Health's MSA in three turns (fictional demo sample): v1 their paper,
// v2 Fieldstone's redlines, v3 their markup. One line per heading or clause, so
// Locket's comparison and cited findings line up with the clause numbers.

type Turn = 1 | 2 | 3
const pick = (turn: Turn, [theirs, ours, markup]: [string, string, string]) => (turn === 1 ? theirs : turn === 2 ? ours : markup)

export function msaText(turn: Turn): string {
  const v3 = turn === 3
  const lines = [
    'MASTER SUBSCRIPTION AGREEMENT',
    'Brightline Health, Inc. ("Customer") and Fieldstone Software, Inc. ("Fieldstone"). Fictional sample for the Locket demo.',
    '1. Definitions',
    '1.1 "Platform" means Fieldstone\'s hosted software and its documentation, as described in each Order Form.',
    '1.2 "Order Form" means an ordering document signed by both parties that references this Agreement.',
    '2. Subscription',
    '2.1 Fieldstone grants Customer a non-exclusive, non-transferable right to use the Platform during the Subscription Term for its internal business purposes.',
    '2.2 Customer shall not resell, sublicense or reverse engineer the Platform.',
    '3. Customer Data',
    '3.1 Customer owns all Customer Data, and Fieldstone processes Customer Data only to provide the Platform.',
    '3.2 Fieldstone shall return or delete Customer Data within thirty (30) days after termination.',
    '4. Security',
    '4.1 Fieldstone shall maintain a written information security program and a current SOC 2 Type II report.',
    '4.2 Fieldstone shall notify Customer of a security incident affecting Customer Data within seventy-two (72) hours.',
    '5. Service Levels',
    '5.1 The Platform will be available 99.9% of each calendar month, excluding scheduled maintenance.',
    '5.2 Service credits under the service level schedule are Customer\'s sole remedy for unavailability.',
    '6. Payment Terms',
    `6.1 Invoices are due and payable within ${pick(turn, ['ninety (90)', 'thirty (30)', 'forty-five (45)'])} days of the invoice date. Customer will not withhold or offset any amounts owed except as required by applicable law.`,
    '6.2 Fees are stated and payable in US dollars and exclude sales tax.',
    '7. Additional Terms',
    '7.1 Each party shall comply with all laws that apply to its performance under this Agreement.',
    "7.2 Fieldstone may identify Customer as a customer by name and logo with Customer's prior written consent.",
    "7.3 Neither party shall solicit for employment the other party's employees engaged in the Services during the Term.",
    ...(v3 ? ['7.4 Exclusivity. During the Term, Fieldstone shall not provide the Platform to any other health system in Tennessee.'] : []),
    '8. General Provisions',
    '8.1 Notices must be in writing and are effective on receipt at the address in the Order Form.',
    '8.2 This Agreement and each Order Form are the parties\' entire agreement on their subject matter.',
    '9. Liability',
    '9.1 Each party shall indemnify the other against third-party claims arising from its breach of Section 3 or Section 4.',
    `9.2 Except for claims arising from a party's indemnification obligations, neither party shall be liable for any indirect, incidental, special or consequential damages, and each party's total liability under this Agreement is ${turn === 2 ? "capped at 12 months' fees" : 'unlimited'}.`,
    '10. Insurance',
    `10.1 Fieldstone shall maintain cyber liability insurance of at least $5,000,000 per claim${v3 ? ' and in the aggregate' : ''}.`,
    `10.2 Each party shall provide a certificate of insurance on ${v3 ? 'written ' : ''}request.`,
    '11. Confidentiality',
    `11.1 Each party shall protect the other party's Confidential Information${v3 ? ', including trade secrets,' : ''} with at least reasonable care.`,
    `11.2 These ${v3 ? 'confidentiality ' : ''}obligations survive for three (3) years after termination.`,
    '12. Term and Renewal',
    '12.1 The Subscription Term starts on November 1, 2026 and ends on October 31, 2029.',
    '12.2 The Subscription Term renews for one (1) year unless either party gives ninety (90) days\' notice before it ends.',
    '13. Termination',
    `13.1 Either party may terminate for material breach not cured within thirty (30) days after ${v3 ? 'receiving ' : ''}written notice.`,
    `13.2 On termination, Customer shall pay fees for the Platform through the ${v3 ? 'effective ' : ''}termination date.`,
    '14. Governing Law',
    `14.1 This Agreement is governed by the laws of the State of ${pick(turn, ['Tennessee', 'North Carolina', 'Delaware'])}.`,
    '14.2 Each party waives any right to a jury trial in any action arising under this Agreement.',
    '15. Assignment',
    `15.1 This Agreement binds and benefits the parties and their ${v3 ? 'respective ' : ''}permitted successors and assigns.`,
    `15.2 Neither party may assign this Agreement without the other party's prior written consent${v3 ? ', not to be unreasonably withheld' : ''}.`,
  ]
  return lines.join('\n')
}

/** Customer MSA playbook v7: thirty rules, each tied to the clause it reads. */
export const playbookRules: { key: string; title: string; clause: string; preferred: string; alternatives: string[]; authority: 'counsel' | 'approver'; guidance: string }[] = [
  { key: 'S-1', title: 'License scope', clause: '2.1', preferred: 'A non-exclusive, non-transferable subscription for internal use.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'S-2', title: 'Use restrictions', clause: '2.2', preferred: 'No resale, sublicensing or reverse engineering.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'D-1', title: 'Data ownership', clause: '3.1', preferred: 'The customer owns its data; we process it only to provide the Platform.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'D-2', title: 'Data return', clause: '3.2', preferred: 'Return or delete customer data within 30 days of termination.', alternatives: ['Within 60 days.'], authority: 'counsel', guidance: '' },
  { key: 'SEC-1', title: 'Security program', clause: '4.1', preferred: 'A written security program and a current SOC 2 Type II report.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'SEC-2', title: 'Incident notice', clause: '4.2', preferred: 'Notice of a security incident within 72 hours.', alternatives: ['Within 48 hours.'], authority: 'counsel', guidance: '' },
  { key: 'SLA-1', title: 'Availability', clause: '5.1', preferred: '99.9% monthly availability excluding scheduled maintenance.', alternatives: [], authority: 'approver', guidance: '' },
  { key: 'SLA-2', title: 'Credits as sole remedy', clause: '5.2', preferred: 'Service credits are the sole remedy for unavailability.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'P-2', title: 'Payment terms', clause: '6.1', preferred: 'Invoices due within thirty (30) days.', alternatives: ['Net 45 is the fallback.'], authority: 'approver', guidance: 'Anything past Net 45 goes to the CFO.' },
  { key: 'P-3', title: 'Currency and tax', clause: '6.2', preferred: 'Fees in US dollars, excluding sales tax.', alternatives: [], authority: 'approver', guidance: '' },
  { key: 'C-1', title: 'Compliance with laws', clause: '7.1', preferred: 'Each party complies with the laws that apply to it.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'C-2', title: 'Publicity', clause: '7.2', preferred: 'Name and logo use only with written consent.', alternatives: ['Consent by email.'], authority: 'approver', guidance: '' },
  { key: 'C-3', title: 'Non-solicitation', clause: '7.3', preferred: 'Mutual non-solicitation during the term.', alternatives: ['Up to 12 months after the term.'], authority: 'counsel', guidance: '' },
  { key: 'C-4', title: 'Exclusivity', clause: '7.4', preferred: 'No exclusivity, territorial or otherwise.', alternatives: [], authority: 'counsel', guidance: 'Exclusivity is never offered; reject it.' },
  { key: 'N-1', title: 'Notices', clause: '8.1', preferred: 'Written notice, effective on receipt.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'N-2', title: 'Entire agreement', clause: '8.2', preferred: 'The MSA and its order forms are the entire agreement.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'I-1', title: 'Mutual indemnity', clause: '9.1', preferred: 'Mutual indemnity for data and security breaches.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'L-3', title: 'Liability cap', clause: '9.2', preferred: "Cap liability at 12 months' fees.", alternatives: [], authority: 'counsel', guidance: 'Uncapped liability needs counsel.' },
  { key: 'IN-1', title: 'Cyber insurance', clause: '10.1', preferred: 'Cyber liability cover of at least $5,000,000 per claim.', alternatives: [], authority: 'approver', guidance: '' },
  { key: 'IN-2', title: 'Insurance certificates', clause: '10.2', preferred: 'Certificates of insurance on request.', alternatives: [], authority: 'approver', guidance: '' },
  { key: 'CF-1', title: 'Confidentiality standard', clause: '11.1', preferred: 'At least reasonable care.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'CF-2', title: 'Confidentiality survival', clause: '11.2', preferred: 'Three years after termination.', alternatives: ['Five years.'], authority: 'counsel', guidance: '' },
  { key: 'R-1', title: 'Subscription term', clause: '12.1', preferred: 'A fixed term stated with its start and end dates.', alternatives: [], authority: 'approver', guidance: '' },
  { key: 'R-2', title: 'Renewal notice', clause: '12.2', preferred: 'One-year renewals with 90 days\' notice.', alternatives: ['60 days\' notice.'], authority: 'approver', guidance: '' },
  { key: 'T-1', title: 'Termination for breach', clause: '13.1', preferred: 'A 30-day cure period.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'T-2', title: 'Fees on termination', clause: '13.2', preferred: 'Fees owed through the termination date.', alternatives: [], authority: 'approver', guidance: '' },
  { key: 'G-1', title: 'Governing law', clause: '14.1', preferred: 'North Carolina law.', alternatives: ['Delaware law is the fallback.'], authority: 'counsel', guidance: '' },
  { key: 'G-2', title: 'Jury waiver', clause: '14.2', preferred: 'Mutual jury waiver.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'A-1', title: 'Successors', clause: '15.1', preferred: 'Binding on permitted successors and assigns.', alternatives: [], authority: 'counsel', guidance: '' },
  { key: 'A-2', title: 'Assignment', clause: '15.2', preferred: 'No assignment without prior written consent.', alternatives: ['Consent not to be unreasonably withheld.'], authority: 'counsel', guidance: '' },
]

/** How the agent's review of v3 reads each rule; every other rule is met as written. */
export const v3Findings: Record<string, { result: 'met' | 'breached'; explanation: string; proposedWording?: string }> = {
  'P-2': { result: 'met', explanation: 'Net 45 is the fallback in rule P-2, so the change is within the playbook.' },
  'C-4': { result: 'breached', explanation: 'Rule C-4 allows no exclusivity. Inserted in v3; reject it.', proposedWording: 'Delete §7.4.' },
  'L-3': { result: 'breached', explanation: "Rule L-3 caps liability at 12 months' fees. v3 restores \"unlimited\".", proposedWording: "capped at 12 months' fees" },
  'G-1': { result: 'met', explanation: 'Delaware is the fallback in rule G-1.' },
}
