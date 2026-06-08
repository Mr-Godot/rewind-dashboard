import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard/stats')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
