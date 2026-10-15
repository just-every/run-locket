import { Badge, Icon } from '../../ui/controls'
import { Engraved } from '../../ui/engraved'
import { Actions } from './Actions'
import { hero } from './copy'

/** The promise on the left; on the right one agreement's 1-2-3, printed as engraved cards of the real product. */
export function Hero() {
  return (
    <section className="ld-hero" id="top" aria-labelledby="hero-title">
      <div className="ld-hero-copy">
        <h1 id="hero-title">{hero.headline[0]}<br />{hero.headline[1]}</h1>
        <p className="ld-subhead">{hero.subhead}</p>
        <p className="ld-free">100% free, open source alternative to <strong>{hero.alternatives[0]}</strong> and <strong>{hero.alternatives[1]}</strong></p>
        <Actions demo />
      </div>
      <figure className="ld-steps" aria-label={hero.drawing}>
        <ol>
          <li>
            <p className="ld-step-label"><span className="ld-step-number">1</span>Approved</p>
            <Engraved className="lk-large" medallion="document">
              <div className="ld-card-row">
                <div><p className="ld-card-title">Harbour Supplies MSA</p><span className="ld-tag">v3</span></div>
                <Badge value="approved" label="Approved" />
              </div>
            </Engraved>
          </li>
          <li>
            <p className="ld-step-label"><span className="ld-step-number">2</span>Signed and kept</p>
            <Engraved className="lk-large" medallion="documents">
              <div className="ld-card-row">
                <ul className="ld-files">
                  <li><Icon name="document" />Signed PDF</li>
                  <li><Icon name="certificate" />Certificate of completion</li>
                </ul>
                <Badge value="executed" label="Executed" />
              </div>
            </Engraved>
          </li>
          <li>
            <p className="ld-step-label"><span className="ld-step-number">3</span>Decided in time</p>
            <Engraved className="lk-large" medallion="calendar">
              <div className="ld-card-row">
                <div><p className="ld-card-label">Notice deadline</p><p className="ld-date">01 May 2027, 23:59</p><p className="ld-card-label">Australia/Sydney</p></div>
                <Badge value="approved" label="Renew" />
              </div>
            </Engraved>
          </li>
        </ol>
      </figure>
    </section>
  )
}
