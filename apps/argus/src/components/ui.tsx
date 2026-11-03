import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

export function Card({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-white p-5 ${className}`}>
      {(title || aside) && (
        <header className="mb-3 flex items-start justify-between gap-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & ComponentProps<'input'>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        {...input}
        className="w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] outline-none focus:border-accent"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function TextArea({ label, hint, ...input }: { label: string; hint?: string } & ComponentProps<'textarea'>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <textarea
        {...input}
        className="w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] outline-none focus:border-accent"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

const buttonStyles = {
  primary: 'bg-accent text-white hover:brightness-110',
  secondary: 'border border-line bg-white hover:bg-paper',
  danger: 'border border-line bg-white text-bad hover:bg-red-50',
}

export function Button({ variant = 'primary', className = '', ...props }: { variant?: keyof typeof buttonStyles } & ComponentProps<'button'>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-60 ${buttonStyles[variant]} ${className}`}
    />
  )
}

export function ButtonLink({ variant = 'primary', className = '', ...props }: { variant?: keyof typeof buttonStyles } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium ${buttonStyles[variant]} ${className}`}
    />
  )
}

/** Full-page navigation (OAuth redirects, route handlers). Not a client-side Link. */
export function ButtonAnchor({ variant = 'primary', className = '', ...props }: { variant?: keyof typeof buttonStyles } & ComponentProps<'a'>) {
  return (
    <a
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium ${buttonStyles[variant]} ${className}`}
    />
  )
}

const tones = {
  ok: 'bg-green-50 text-ok border-green-200',
  warn: 'bg-amber-50 text-warn border-amber-200',
  bad: 'bg-red-50 text-bad border-red-200',
  info: 'bg-blue-50 text-accent border-blue-200',
  muted: 'bg-paper text-muted border-line',
}

export function Badge({ tone = 'muted', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function Flash({ tone, children }: { tone: 'ok' | 'bad' | 'info' | 'warn'; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>
}

export function when(iso: string | null | undefined): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' })
}
