import '../../ui/style/tokens.css'
import '../../ui/style/controls.css'
import '../../ui/style/engraved.css'
import './landing.css'
import './landing-responsive.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { Actions } from './Actions'
import { hero } from './copy'
import { CompareCard, DeadlinesCard, DryRunCard, EvidenceCard, IncludedTiles, LicenceCard, TermsCard } from './drawings'
import { Hero } from './Hero'
import { Section } from './Section'

/** The run site's homepage (run-locket.com): static, no script, every link public. */
export function Landing() {
  return (
    <div className="ld-page">
      <SiteHeader />
      <main>
        <Hero />
        <Section id="deadlines" eyebrow="Notice deadlines" title={<>Every deadline<br />in plain sight.</>} drawing={<DeadlinesCard />}>
          <p>Confirm the end date and notice period once. Locket shows the deadline in the agreement's time zone, while there's time to decide.</p>
        </Section>
        <Section id="signed" eyebrow="Signed and kept" title={<>Know what<br />you signed.</>} drawing={<EvidenceCard />} flip>
          <p>Send through DocuSign or the service you already use. The signed PDF and its certificate are kept exactly as signed.</p>
        </Section>
        <Section id="versions" eyebrow="Versions" title={<>Approve the one<br />you'll sign.</>} drawing={<CompareCard />}>
          <p>Compare any two versions line by line, then approve the exact version that goes out.</p>
        </Section>
        <Section id="terms" eyebrow="Terms and obligations" title={<>Every contract<br />has an owner.</>} drawing={<TermsCard />} flip>
          <p>Terms are confirmed against the signed words. Obligations get a person and a due date.</p>
        </Section>
        <Section id="move-in" eyebrow="Move in" title={<>Bring your DocuSign<br />archive.</>} drawing={<DryRunCard />}>
          <p>A dry run shows every envelope's outcome before anything is written.</p>
        </Section>
        <Section id="included" eyebrow="Also included" title={<>The rest of your<br />contracts.</>} drawing={<IncludedTiles />} />
        <Section id="free" eyebrow="Free" title="100% free." drawing={<LicenceCard />}>
          <p>Free as in code, and free as in cost.<br />MIT licensed, so it's yours to run and change.</p>
          <ul className="ld-proof"><li>No seats.</li><li>No plans.</li><li>No fees.</li></ul>
        </Section>
        <section className="ld-band" id="get-started" aria-labelledby="get-started-title">
          <h2 id="get-started-title">{hero.headline.join(' ')}</h2>
          <Actions />
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
