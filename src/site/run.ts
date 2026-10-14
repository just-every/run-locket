import type { RunData } from '../base/run-site'
import { repository } from './repository'

/** Every string and command on the run site's Run page (/run). */
export const run: RunData = {
  name: 'Locket',
  repository,
  clone: `git clone ${repository}.git locket`,
  folder: 'locket',
  requirements: 'Runs on macOS, Linux or Windows with WSL2.',
  licence: 'MIT',
  docs: true,
  hosted: [],
}
