import type { Config } from 'tailwindcss';

/**
 * Argus design tokens — sourced from the Argus Flow design bundle.
 * Palette is OKLCH so colour-mix in CSS produces clean tinted variants.
 *
 * The `argus-*` aliases stay for backward compat with the older pages
 * (Agents, Channels, Connectors, Health) but are remapped onto the new
 * obsidian/blue/emerald/amber/rose tokens so the visual language is
 * consistent across the whole app.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // ---- design tokens (preferred for new screens) ----
        'bg-0': 'oklch(0.135 0.008 250)',
        'bg-1': 'oklch(0.165 0.009 250)',
        'bg-2': 'oklch(0.195 0.010 250)',
        'bg-3': 'oklch(0.225 0.011 250)',
        line: 'oklch(0.265 0.012 250)',
        'line-strong': 'oklch(0.32 0.013 250)',
        'fg-0': 'oklch(0.97 0.004 250)',
        'fg-1': 'oklch(0.82 0.006 250)',
        'fg-2': 'oklch(0.62 0.008 250)',
        'fg-3': 'oklch(0.46 0.010 250)',
        // tone palette
        blue: 'oklch(0.72 0.16 250)',
        'blue-d': 'oklch(0.52 0.16 250)',
        emerald: 'oklch(0.72 0.15 158)',
        amber: 'oklch(0.78 0.14 78)',
        rose: 'oklch(0.68 0.18 22)',
        // ---- legacy aliases — remapped to design tokens ----
        argus: {
          bg: 'oklch(0.135 0.008 250)',
          panel: 'oklch(0.165 0.009 250)',
          border: 'oklch(0.265 0.012 250)',
          accent: 'oklch(0.72 0.16 250)',
          danger: 'oklch(0.68 0.18 22)',
          warn: 'oklch(0.78 0.14 78)',
          ok: 'oklch(0.72 0.15 158)',
          muted: 'oklch(0.62 0.008 250)',
        },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '10px',
        sm: '6px',
      },
      fontSize: {
        '2xs': '10.5px',
        xs: '11.5px',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 currentColor', opacity: '0.8' },
          '70%': { boxShadow: '0 0 0 8px transparent', opacity: '0' },
          '100%': { boxShadow: '0 0 0 0 transparent', opacity: '0' },
        },
        blink: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        blink: 'blink 1.2s infinite',
      },
    },
  },
  plugins: [],
};
export default config;
