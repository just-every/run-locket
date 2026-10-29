import type { RunData } from '../base/run-site'
import { runPricing } from '../base/run-pricing'
import { repository } from './repository'

/** Every string and command on the run site's Run page (/run). */
export const run: RunData = {
  name: 'Locket',
  repository,
  clone: 'npx -y @runeditrun/rer dev just-every/run-locket',
  licence: 'MIT',
  docs: true,
  paths: { product: null },
  pricing: runPricing,
}
