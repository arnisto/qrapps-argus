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
      <span className="block text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1">
        {label}
      </span>
      <input
        id={inputId}
        {...inputProps}
        className={[
          'block w-full rounded-md bg-surface-2 px-3 py-2 text-sm text-text',
          'placeholder:text-text-3 outline-none transition border',
          'focus:border-accent focus:shadow-focus',
          error ? 'border-red' : 'border-border',
        ].join(' ')}
      />
      {error ? (
        <span className="block text-xs text-red mt-1.5">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-text-3 mt-1.5">{hint}</span>
      ) : null}
    </label>
  );
}
