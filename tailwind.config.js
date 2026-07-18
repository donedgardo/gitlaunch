/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.hbs", "./src/**/*.ts"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (resolve to CSS vars in src/styles/input.css,
        // so they follow light/dark automatically). Use these on new work:
        // bg-surface, text-ink, text-muted, border-line, bg-accent, ...
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        accent: {
          DEFAULT: "var(--accent)",
          2: "var(--accent-2)",
          soft: "var(--accent-soft)",
          ink: "var(--accent-ink)",
        },

        // Global remap: existing pages use the `gray` and `blue` ramps.
        // Re-point them at the instrument-panel neutrals + ignition orange
        // so the whole app inherits the theme with no markup changes.
        // green / red / amber / yellow are left as semantic status colors.
        gray: {
          50: "#f4f6f8",
          100: "#eaedf0",
          200: "#dbe0e5",
          300: "#c7ced4",
          400: "#9ba6b0",
          500: "#6e7a85",
          600: "#55616c",
          700: "#2b3843",
          800: "#18222a",
          900: "#0f171c",
          950: "#0a1014",
        },
        blue: {
          50: "#fff2ec",
          100: "#ffe2d5",
          200: "#ffc9b2",
          300: "#ffa98a",
          400: "#ff8a55",
          500: "#ff6a33",
          600: "#ff5a1f",
          700: "#c74310",
          800: "#9e3a12",
          900: "#3a1c10",
        },
      },
      fontFamily: {
        mono: ["var(--mono)"],
      },
    },
  },
  plugins: [],
};
