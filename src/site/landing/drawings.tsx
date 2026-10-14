// The section drawings: each is the real product card, printed in the engraving. Every word is DOM text.
import { Badge, Icon, type IconName } from '../../ui/controls'
import { Engraved } from '../../ui/engraved'

export function DeadlinesCard() {
  return (
    <Engraved className="lk-medium" medallion="calendar">
      <p className="ld-card-heading">Upcoming notice deadlines</p>
      <ul className="ld-rows">
        <li><span>Harbour Supplies MSA</span><span>01 May 2027, 23:59</span><Badge value="approved" label="Renew" /></li>
        <li><span>Kestrel Cleaning</span><span>in 42 days</span><Badge value="undetermined" label="Decide soon" /></li>
      </ul>
    </Engraved>
  )
}

export function EvidenceCard() {
  return (
    <Engraved className="lk-medium" medallion="documents">
      <div className="ld-card-row">
        <div>
          <p className="ld-card-heading">Execution evidence</p>
          <ul className="ld-files">
            <li><Icon name="document" />Signed PDF</li>
            <li><Icon name="certificate" />Certificate of completion</li>
            <li><Icon name="id" />Envelope ID</li>
          </ul>
        </div>
        <Badge value="executed" label="Executed" />
      </div>
    </Engraved>
  )
}

export function CompareCard() {
  return (
    <Engraved className="lk-medium" medallion="documents">
      <div className="ld-card-row ld-card-top">
        <div><p className="ld-card-heading">Compare versions</p><p className="ld-card-label">v2 → v3</p></div>
        <Badge value="approved" label="Current · approved" />
      </div>
      <div className="ld-diff" aria-label="One line removed, one line added">
        <p className="ld-diff-del"><span aria-hidden="true">−</span><i /></p>
        <p className="ld-diff-add"><span aria-hidden="true">+</span><i /></p>
      </div>
    </Engraved>
  )
}

export function TermsCard() {
  return (
    <Engraved className="lk-medium" medallion="document">
      <p className="ld-card-heading">Terms</p>
      <ul className="ld-rows"><li><span>Notice period</span><span>60 days</span><Badge value="confirmed" label="Confirmed" /></li></ul>
      <p className="ld-card-heading ld-card-heading-next">Obligations</p>
      <ul className="ld-rows"><li><span>Annual insurance certificate</span><span>Priya Shah</span><span>Quarterly</span></li></ul>
    </Engraved>
  )
}

export function DryRunCard() {
  return (
    <Engraved className="lk-medium" medallion="document">
      <p className="ld-card-heading">New DocuSign archive dry run</p>
      <dl className="ld-counts">
        <div><dt>Envelopes in report</dt><dd>214</dd></div>
        <div><dt>To import</dt><dd>209</dd></div>
        <div><dt>Missing certificates</dt><dd>2</dd></div>
      </dl>
    </Engraved>
  )
}

const included: [IconName, string][] = [
  ['document', 'Templates and a clause playbook'],
  ['document', 'Restricted agreements'],
  ['search', 'Search inside every version'],
  ['people', 'Roles for counsel and approvers'],
  ['person-doc', 'Agents prepare, people approve'],
  ['export', 'Export everything'],
]
export function IncludedTiles() {
  return (
    <ul className="ld-tiles">
      {included.map(([icon, text]) => <li key={text}><Engraved className="ld-tile" medallion={icon}><p>{text}</p></Engraved></li>)}
    </ul>
  )
}

export function LicenceCard() {
  return <Engraved className="lk-medium ld-licence" medallion="document"><p>MIT License</p></Engraved>
}
