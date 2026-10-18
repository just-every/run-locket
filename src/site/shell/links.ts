import { repository } from '../repository'

/** Every link the run site's chrome and homepage use: all public, none instance-only. */
export const links = {
  home: '/',
  run: '/run',
  docs: '/docs',
  contract: '/contract',
  source: repository,
  licence: `${repository}/blob/main/LICENSE`,
  // The hosted demo (deploy-demo.json, the Run demo workflow): a throwaway copy with sample data.
  demo: 'https://demo.run-locket.com/',
}
