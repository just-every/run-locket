import { createDependencies } from './modules/dependencies/index.mjs'
import { createOwnerClaimHandler, createIdpOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { framedDocument } from './frame'
import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 /** Owner deployment attestation: provider contract prohibits training on contract text. */
 AI_TRAINING_PROHIBITED?:string
 UPTIME_ORIGIN?:string
 UPTIME_METRICS_KEY?:string
