// Fictional Fieldstone Software work (Raleigh, NC), kept separate from the seed's empty real installs.
// The demo owner is Priya Raman, legal operations lead; Brightline Health's MSA is src/demo/brightline.ts.
export const ownerName = 'Priya Raman'
export const team = [
  ['demo-commercial', 'Marcus Lee', 'marcus@fieldstone.example', 'approver'],
  ['demo-operations', 'Jenna Hart', 'jenna@fieldstone.example', 'requester'],
  ['demo-supply', 'Kevin Walsh', 'kevin@fieldstone.example', 'requester'],
  ['demo-onboarding', 'Dev Patel', 'dev@fieldstone.example', 'viewer'],
  ['demo-agent', 'Locket', 'agent@fieldstone.example', 'agent'],
] as const
/** key, counterparty, title, type, status, value in cents, days to the needed-by date (or the notice deadline), notice days. */
export const examples = [
  ['ridgeline', 'Ridgeline Payroll', 'Payroll services agreement', 'supplier', 'in_review', 1800000, 7, 30],
  ['pinecrest', 'Pinecrest Clinics', 'Platform subscription', 'customer', 'approved', 6400000, 10, 30],
  ['cedarpoint', 'Cedar Point Medical', 'Pilot agreement', 'customer', 'draft', 2400000, 21, 30],
  ['northwind', 'Northwind Hosting', 'Hosting services agreement', 'supplier', 'imported', 9600000, 25, 60],
  ['cobalt', 'Cobalt Security', 'Security monitoring subscription', 'supplier', 'imported', 4200000, 14, 90],
  ['bluebird', 'Bluebird Facilities', 'Facilities services agreement', 'supplier', 'imported', 3600000, 56, 90],
  ['lakeview', 'Lakeview Dental Group', 'Platform subscription', 'customer', 'approved', 3800000, 12, 30],
  ['marlow', 'Marlow Analytics', 'Mutual confidentiality agreement', 'nda', 'draft', null, 12, 30],
  ['summit', 'Summit Ridge Health', 'Platform subscription MSA', 'customer', 'approved', 12000000, 18, 30],
  ['harbor', 'Harbor Data', 'Data warehouse subscription', 'supplier', 'imported', 2880000, 72, 60],
  ['tristate', 'Tri-State Imaging', 'Mutual confidentiality agreement', 'nda', 'in_review', null, 5, 30],
] as const
export const clauses = [
  { key: 'payment', title: 'Payment', variants: [{ id: 'net30', label: 'Net 30', text: 'Invoices are payable within 30 days.' }, { id: 'net45', label: 'Net 45', text: 'Invoices are payable within 45 days.' }] },
  { key: 'liability', title: 'Liability', variants: [{ id: 'cap', label: '12 months of fees', text: "Liability is capped at 12 months' fees." }] },
]
