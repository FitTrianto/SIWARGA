// SIWARGA design tokens, dipakai sebagai Tailwind preset oleh aplikasi.
// Format CommonJS agar bisa di-require oleh tailwind.config.cjs.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  presets: [],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "secondary-fixed": "#ffdbca",
        "surface-container-low": "#f2f3ff",
        "background": "#faf8ff",
        "error": "#ba1a1a",
        "on-surface": "#131b2e",
        "on-error": "#ffffff",
        "on-primary": "#ffffff",
        "surface-container": "#eaedff",
        "primary-container": "#15803d",
        "tertiary-fixed": "#ffdad6",
        "on-secondary-fixed": "#331200",
        "surface-container-highest": "#dae2fd",
        "on-tertiary-fixed": "#410002",
        "on-tertiary-container": "#fff1ef",
        "on-surface-variant": "#3f493f",
        "on-background": "#131b2e",
        "primary-fixed-dim": "#79db8d",
        "inverse-primary": "#79db8d",
        "secondary-fixed-dim": "#ffb68e",
        "outline-variant": "#becabc",
        "inverse-on-surface": "#eef0ff",
        "on-primary-fixed-variant": "#005323",
        "on-primary-container": "#d3ffd5",
        "on-secondary-container": "#682c00",
        "surface-container-high": "#e2e7ff",
        "tertiary": "#b20010",
        "surface-container-lowest": "#ffffff",
        "surface": "#faf8ff",
        "on-secondary-fixed-variant": "#763300",
        "secondary-container": "#fd8a42",
        "primary": "#00652c",
        "inverse-surface": "#283044",
        "surface-dim": "#d2d9f4",
        "surface-tint": "#006d30",
        "surface-variant": "#dae2fd",
        "on-tertiary": "#ffffff",
        "primary-fixed": "#95f8a7",
        "on-error-container": "#93000a",
        "on-tertiary-fixed-variant": "#93000b",
        "error-container": "#ffdad6",
        "tertiary-fixed-dim": "#ffb4ab",
        "on-primary-fixed": "#00210a",
        "on-secondary": "#ffffff",
        "secondary": "#9b4500",
        "surface-bright": "#faf8ff",
        "tertiary-container": "#d82324",
        "outline": "#6f7a6e"
      },
      borderRadius: {
        DEFAULT: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px"
      },
      spacing: {
        "gutter-lg": "1.5rem",
        "margin-lg": "2rem",
        "space-sm": "0.75rem",
        "gutter": "1.25rem",
        "space-md": "1.25rem",
        "space-lg": "1.75rem",
        "margin": "1.25rem",
        "space-xl": "2.5rem",
        "space-xs": "0.5rem"
      },
      fontFamily: {
        "sans": ["Plus Jakarta Sans", "system-ui", "-apple-system", "sans-serif"],
        "mono": ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        "body-xl": ["Plus Jakarta Sans"],
        "headline-lg-mobile": ["Plus Jakarta Sans"],
        "headline-sm": ["Plus Jakarta Sans"],
        "headline-lg": ["Plus Jakarta Sans"],
        "headline-md": ["Plus Jakarta Sans"],
        "body-lg": ["Plus Jakarta Sans"],
        "label-md": ["Plus Jakarta Sans"],
        "body-md": ["Plus Jakarta Sans"],
        "label-lg": ["Plus Jakarta Sans"]
      },
      fontSize: {
        "body-xl": ["20px", { lineHeight: "30px", fontWeight: "400" }],
        "headline-lg-mobile": ["28px", { lineHeight: "36px", fontWeight: "700" }],
        "headline-sm": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "headline-lg": ["36px", { lineHeight: "44px", fontWeight: "700" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "700" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "label-md": ["16px", { lineHeight: "22px", fontWeight: "600" }],
        "body-md": ["16px", { lineHeight: "26px", fontWeight: "400" }],
        "label-lg": ["18px", { lineHeight: "24px", fontWeight: "600" }]
      },
      // Skala z-index SIWARGA — pakai HANYA nilai ini, jangan angka acak:
      //   0/10  layer konten · 20 bar menempel (announcement) · 40 header sticky
      //   50    sidebar, dropdown, modal halaman
      //   60    toast & modal level layout (selalu di atas modal halaman)
      //   70    skip-to-content (teratas saat difokus keyboard)
      zIndex: {
        "60": "60",
        "70": "70"
      }
    }
  }
};