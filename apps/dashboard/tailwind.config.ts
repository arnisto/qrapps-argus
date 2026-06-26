import type { Config } from 'tailwindcss';

/**
 * Tokens mirror the Argus Console design system (light theme as default,
 * dark theme via a `.dark` class on <html>). All semantic colors are
 * routed through CSS variables defined in globals.css so the theme can
 * swap without rebuilding utility classes.
 *
 * Source: design/imports/argus-console.dc.html (themeVars()).
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        inset: 'var(--inset)',
        border: 'var(--border)',
        'border-2': 'var(--border-2)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        green: 'var(--green)',
        'green-soft': 'var(--green-soft)',
        amber: 'var(--amber)',
        'amber-soft': 'var(--amber-soft)',
        red: 'var(--red)',
        'red-soft': 'var(--red-soft)',
        // Hardcoded swatches the design uses for project / env identity
        // (purple = Marketing / Knowledge KPI, orange = Speedo / RH / Open tickets).
        'project-purple': '#6b5bd6',
        'project-orange': '#c2742e',
        // Legacy v0.2 tokens — kept as aliases so the old observability
        // pages (investigators / agents / findings / health / memory)
        // don't render broken while they wait their turn for the
        // migration. New code should use the canonical tokens above.
        'bg-0': 'var(--bg)',
        'bg-1': 'var(--surface)',
        'bg-2': 'var(--surface-2)',
        'bg-3': 'var(--inset)',
        'fg-0': 'var(--text)',
        'fg-1': 'var(--text)',
        'fg-2': 'var(--text-2)',
        'fg-3': 'var(--text-3)',
        line: 'var(--border)',
        'line-strong': 'var(--border-2)',
        blue: 'var(--accent)',
        'blue-d': 'var(--accent)',
        emerald: 'var(--green)',
        rose: 'var(--red)',
        argus: {
          bg: 'var(--bg)',
          panel: 'var(--surface)',
          border: 'var(--border)',
          accent: 'var(--accent)',
          danger: 'var(--red)',
          warn: 'var(--amber)',
          ok: 'var(--green)',
          muted: 'var(--text-3)',
        },
      },
      fontFamily: {
        // intigo-brain parity: Hanken Grotesk for body (warmer + slightly
        // tighter than Plex Sans), Schibsted Grotesk for display (headings
        // + KPI values, -0.02em tracking). IBM Plex Sans stays as a
        // fallback ahead of system-ui so existing pages don't visibly
        // shift if the Google CDN is slow.
        sans: [
          'Hanken Grotesk',
          'IBM Plex Sans',
          'IBM Plex Sans Arabic',
          'system-ui',
          'sans-serif',
        ],
        display: [
          'Schibsted Grotesk',
          'Hanken Grotesk',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'IBM Plex Mono',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
      },
      fontSize: {
        // Design uses very specific sizes — exposed as utilities so we
        // never have to write `text-[13px]` inline.
        '2xs': ['10px', { lineHeight: '1.4' }],
        xs: ['11.5px', { lineHeight: '1.45' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['13.5px', { lineHeight: '1.55' }],
        md: ['14px', { lineHeight: '1.55' }],
        lg: ['15px', { lineHeight: '1.5' }],
        xl: ['17px', { lineHeight: '1.4' }],
        '2xl': ['21px', { lineHeight: '1.3' }],
        '3xl': ['28px', { lineHeight: '1' }],
      },
      letterSpacing: {
        tight: '-0.01em',
        wide: '0.05em',
        wider: '0.08em',
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '5px',
        md: '7px',
        lg: '9px',
        xl: '11px',
        '2xl': '13px',
        '3xl': '16px',
      },
      boxShadow: {
        // The signature two-layer card shadow from the design system.
        card: 'var(--shadow)',
        modal: '0 20px 60px -20px rgba(0,0,0,.5)',
        focus: '0 0 0 4px var(--accent-soft)',
      },
      keyframes: {
        fade: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        toast: {
          from: { opacity: '0', transform: 'translate(-50%, 10px)' },
          to: { opacity: '1', transform: 'translate(-50%, 0)' },
        },
        blink: {
          '0%,80%,100%': { opacity: '0.25' },
          '40%': { opacity: '1' },
        },
      },
      animation: {
        fade: 'fade 0.25s ease',
        toast: 'toast 0.3s ease',
        blink: 'blink 1.2s infinite',
      },
    },
  },
  plugins: [],
};
export default config;
