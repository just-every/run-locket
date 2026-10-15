// Fictional Northbank Studio work, kept separate from the seed's empty real installs.
// The hosted demo's owner signs in as nora@northbank.example (deploy-demo.json).
export const ownerName = 'Nora Blake'
export const team = [
  ['demo-counsel', 'Priya Shah', 'priya@northbank.example', 'counsel'],
  ['demo-commercial', 'Marcus Chen', 'marcus@northbank.example', 'approver'],
  ['demo-operations', 'Ella Wilson', 'ella@northbank.example', 'requester'],
  ['demo-agent', 'Contract assistant', 'assistant@northbank.example', 'agent'],
] as const
export const examples = [
  ['harbour', 'Harbour Supplies', 'Packaging supply agreement', 'supplier', 'in_review', 4800000, 7],
  ['banksia', 'Banksia Health', 'Patient portal design services', 'customer', 'approved', 9600000, 14],
  ['cedar', 'Cedar & Co', 'Brand strategy engagement', 'customer', 'draft', 3200000, 21],
  ['lumina', 'Lumina Cloud', 'Cloud hosting subscription', 'supplier', 'imported', 1800000, 35],
  ['atlas', 'Atlas Logistics', 'Freight services agreement', 'supplier', 'imported', 7200000, 50],
  ['wattle', 'Wattle Workspace', 'Studio lease', 'supplier', 'imported', 5400000, 80],
  ['river', 'Riverbend Foods', 'Retail packaging design', 'customer', 'approved', 6400000, 10],
  ['marlow', 'Marlow Digital', 'Mutual confidentiality agreement', 'nda', 'draft', null, 12],
  ['salt', 'Saltwater Research', 'Customer research engagement', 'customer', 'draft', 2400000, 28],
  ['bright', 'Brightside Energy', 'Annual design retainer', 'customer', 'approved', 12000000, 18],
  ['fern', 'Fern Accounting', 'Accounting services engagement', 'supplier', 'imported', 1500000, 120],
  ['morrow', 'Morrow Partners', 'Partnership confidentiality agreement', 'nda', 'in_review', null, 5],
] as const
export const clauses = [
  { key: 'payment', title: 'Payment', variants: [{ id: 'net30', label: 'Net 30', text: 'Invoices are payable within 30 days.' }, { id: 'net45', label: 'Net 45', text: 'Invoices are payable within 45 days.' }] },
  { key: 'liability', title: 'Liability', variants: [{ id: 'cap', label: '12 months of fees', text: 'Liability is capped at fees paid in the prior 12 months.' }] },
]
export const rules = [
  { key: 'payment', title: 'Payment terms', preferred: 'Invoices are payable within 30 days.', alternatives: ['Invoices are payable within 45 days.'], authority: 'approver', guidance: 'Confirm any longer payment period with the commercial owner.' },
  { key: 'liability', title: 'Limitation of liability', preferred: 'Liability is capped at fees paid in the prior 12 months.', alternatives: [], authority: 'counsel', guidance: 'Counsel reviews uncapped liability.' },
]
