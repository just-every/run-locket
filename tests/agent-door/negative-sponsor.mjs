import assert from 'node:assert/strict'
import { confirmedPerson, invitePerson } from './colleague.mjs'

let identity
let initializeReviewer
let confirmed

export function registerInactiveReviewer(reviewers, owner) {
  initializeReviewer = () => reviewers.initialize('inactive', owner)
}

export function inactiveSponsor() {
  assert.ok(identity, 'The negative sponsor must complete native confirmation')
  return identity
}

export default async function (context) {
  if (context.sub) {
    // Roster binding precedes this sponsor initializer. The declared reviewer
    // mailbox then confirms the real invitation, returning its native response.
    assert.ok(initializeReviewer)
    await initializeReviewer()
    assert.equal(identity.email, context.email)
    identity = { ...identity, sub: context.sub }
    return confirmed
  }
  confirmed = await invitePerson(context, 'Synthetic Locket Negative Sponsor', 'admin')
  identity = await confirmedPerson(context, confirmed)
  return confirmed
}
