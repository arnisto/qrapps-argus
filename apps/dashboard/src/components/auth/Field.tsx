import type { InputHTMLAttributes } from 'react';

/**
 * Labelled input. Responsive sizing (taller on mobile for fat-fingers),
 * dark-mode focus ring sourced from the design tokens.
 */
export function Field({
  label,
  hint,
  error,
  id,
  ...inputProps
}: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const inputId = id ?? inputProps.name;
  return (
    <label htmlFor={inputId} className="block">
      <span className="block text-xs uppercase tracking-wider text-fg-2 mb-1.5">{label}</span>
      <input
        id={inputId}
        {...inputProps}
        className={[
          'block w-full rounded-md bg-bg-0 border px-3.5 py-2.5 text-[15px] text-fg-0',
          'placeholder:text-fg-3 outline-none transition',
          'focus:border-blue focus:ring-2 focus:ring-blue/30',
          error ? 'border-rose' : 'border-line',
        ].join(' ')}
      />
      {error ? (
        <span className="block text-xs text-rose mt-1.5">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-fg-3 mt-1.5">{hint}</span>
      ) : null}
    </label>
  );
}
