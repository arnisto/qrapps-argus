'use client'

import { useFormStatus } from 'react-dom'
import type { ComponentProps } from 'react'
import { Button } from './ui'

/** A submit button that disables itself and shows `pendingLabel` while the server action runs. */
export function SubmitButton({ pendingLabel, children, ...props }: { pendingLabel?: string } & ComponentProps<typeof Button>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? 'Working…') : children}
    </Button>
  )
}
