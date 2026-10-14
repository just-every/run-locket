import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { LocketApp } from '../ui/app'

export const Route = createFileRoute('/app')({
  head: () => ({ meta: [{ title: 'Locket — agreements' }] }),
  component: () => <HydrationUnit><LocketApp /></HydrationUnit>,
})
