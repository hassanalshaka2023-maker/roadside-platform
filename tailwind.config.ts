import type { Config } from "tailwindcss";

/**
 * Design tokens for "نجدة الطريق 24".
 *
 * Colours are taken from the flyer (design/flyer.jpg) as documented in the
 * Brand identity section of CLAUDE.md. Everything visual should come from
 * here rather than from ad-hoc hex values in components.
 *
 * NOTE: we are deliberately on Tailwind 3, not 4. Tailwind 4 requires
 * Chrome 111+ / Safari 16.4+, and our users are on old Android phones.
 * Logical properties (ms-/me-/ps-/pe-/text-start) are fully supported in 3,
 * so RTL is unaffected by this choice.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "1.5rem", lg: "2rem" },
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        brand: {
          // Primary CTA colour. Text on yellow is ALWAYS ink, never white.
          yellow: {
            DEFAULT: "#FFD400",
            hover: "#E6BC00",
            soft: "#FFF6C2",
          },
          // Urgency accent: the "24", call-now buttons, alerts. Use sparingly.
          red: {
            DEFAULT: "#E11D24",
            dark: "#B3131A",
            soft: "#FDE7E8",
          },
        },
        // Main dark background and body text.
        ink: {
          DEFAULT: "#0B0B0F",
          soft: "#1A1A22",
        },
        // Secondary dark surfaces (header, footer, admin sidebar).
        navy: {
          DEFAULT: "#0F1626",
          soft: "#1B2438",
        },
        gray: {
          50: "#F8F9FA",
          100: "#F1F3F5",
          200: "#E6E8EB",
          300: "#D0D4D9",
          400: "#A5ACB5",
          500: "#78818C",
          600: "#555E69",
          700: "#3B434D",
          800: "#272D35",
          900: "#171B21",
        },
        success: { DEFAULT: "#0F8A4A", soft: "#E4F5EC" },
        warning: { DEFAULT: "#B7791F", soft: "#FDF3E0" },
        danger: { DEFAULT: "#E11D24", soft: "#FDE7E8" },
      },
      fontFamily: {
        // Wired to next/font in src/app/[locale]/layout.tsx so the font is
        // self-hosted at build time - no runtime request to Google.
        sans: ["var(--font-cairo)", "system-ui", "Segoe UI", "Tahoma", "sans-serif"],
      },
      fontWeight: {
        // The brand uses very heavy Arabic headings.
        heading: "800",
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
      },
      minHeight: {
        // Minimum accessible touch target.
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(11, 11, 15, 0.06), 0 4px 12px rgba(11, 11, 15, 0.06)",
        focus: "0 0 0 3px rgba(255, 212, 0, 0.45)",
      },
      backgroundImage: {
        // Diagonal hazard stripe used as a section divider. Kept as a
        // gradient rather than an image so it costs nothing to download.
        hazard:
          "repeating-linear-gradient(45deg, #FFD400 0, #FFD400 14px, #0B0B0F 14px, #0B0B0F 28px)",
        // Dashed centre line of a road, under the hero. Pure CSS, no image.
        "road-line":
          "repeating-linear-gradient(90deg, rgba(255, 212, 0, 0.55) 0 36px, transparent 36px 72px)",
        // Soft headlight glow behind the hero headline.
        glow: "radial-gradient(60% 80% at 85% 0%, rgba(255, 212, 0, 0.14), transparent 70%)",
      },
    },
  },
  plugins: [],
};

export default config;
