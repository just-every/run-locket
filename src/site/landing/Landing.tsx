import '../styles/site.css'
import '../styles/parts.css'
import '../styles/sections/common.css'
import '../styles/sections/hero.css'
import '../styles/sections/story-a.css'
import '../styles/sections/story-b.css'
import '../styles/sections/story-c.css'
import '../styles/sections/story-d.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { Ask } from './sections/Ask'
import { Brief } from './sections/Brief'
import { Closing } from './sections/Closing'
import { Hero } from './sections/Hero'
import { Interlude } from './sections/Interlude'
import { MovingIn } from './sections/MovingIn'
import { Negotiate } from './sections/Negotiate'
import { Renegotiate } from './sections/Renegotiate'
import { Renewal } from './sections/Renewal'
import { Request } from './sections/Request'
import { Review } from './sections/Review'
import { Sign } from './sections/Sign'
import { Versions } from './sections/Versions'

/** The run site's homepage (run-locket.com), the design desk's thirteen screens in order: static, no script, every link public.
 * It follows Priya Raman at Fieldstone Software through Brightline Health's MSA and Northwind Hosting's renewal. */
export function Landing() {
  return (
    <div className="site">
      <SiteHeader />
      <main id="main">
        <Hero />
        <Versions />
        <Request />
        <Review />
        <Negotiate />
        <Sign />
        <Renewal />
        <Ask />
        <Brief />
        <Renegotiate />
        <Interlude />
        <MovingIn />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  )
}
