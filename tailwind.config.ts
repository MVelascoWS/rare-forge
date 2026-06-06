import type { Config } from "tailwindcss";

/**
 * Tailwind maps to the Rare Forge design-system CSS variables
 * (src/styles/design-system). Components use these utilities or the .rf-*
 * brand helpers — never hardcoded hex. See DESIGN_SPEC.md.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Canonical token-mapped colors (DESIGN_SPEC).
        canvas: "var(--surface-canvas)",
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        "surface-inset": "var(--surface-inset)",
        card: "var(--surface-card)",
        overlay: "var(--surface-overlay)",
        t1: "var(--text-1)",
        t2: "var(--text-2)",
        t3: "var(--text-3)",
        t4: "var(--text-4)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-press": "var(--accent-press)",
        "on-accent": "var(--on-accent)",
        verified: "var(--verified)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",

        // Subtle status fills (opacity modifiers don't work on CSS-var colors,
        // so the design system ships pre-tinted *-subtle tokens for pill/callout
        // backgrounds). Pair, e.g., bg-info-subtle + text-info.
        "accent-subtle": "var(--accent-subtle)",
        "accent-border": "var(--accent-border)",
        "verified-subtle": "var(--verified-subtle)",
        "success-subtle": "var(--success-subtle)",
        "warning-subtle": "var(--warning-subtle)",
        "danger-subtle": "var(--danger-subtle)",
        "info-subtle": "var(--info-subtle)",
        // Frosted surface for the top nav + modal backdrops.
        glass: "var(--glass-bg)",

        // --- TEMP legacy aliases (pre-design-system names). Removed once every
        // screen is migrated to the canonical tokens above. Keeps each review
        // checkpoint visually coherent during the styling pass. ---
        bg: "var(--surface-canvas)",
        fg: "var(--text-1)",
        muted: "var(--text-3)",
        "surface-2": "var(--surface-raised)",
        "accent-fg": "var(--on-accent)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        // card = ambient depth + faint top inner highlight (catches light).
        card: "var(--shadow-md), var(--highlight-top)",
        "glow-accent": "var(--glow-accent)",
        "glow-verified": "var(--glow-verified)",
        "glow-prism": "var(--glow-prism)",
      },
      backgroundImage: {
        prism: "var(--gradient-prism)",
        "prism-soft": "var(--gradient-prism-soft)",
        ember: "var(--gradient-ember)",
        aurora: "var(--gradient-aurora)",
      },
    },
  },
  plugins: [],
};

export default config;
