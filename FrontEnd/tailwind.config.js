/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        erp: {
          primary: 'var(--erp-primary)',
          secondary: 'var(--erp-accent)',
          border: 'var(--erp-border)',
          bg: {
            page: 'var(--erp-bg-page)',
            card: 'var(--erp-bg-card)',
          },
          text: {
            primary: 'var(--erp-text-primary)',
            secondary: 'var(--erp-text-secondary)',
            muted: 'var(--erp-text-muted)',
          },
        },
      },
      borderRadius: {
        erp: 'var(--erp-radius)',
      },
      boxShadow: {
        erp: 'var(--erp-shadow)',
      },
    },
  },
  plugins: [],
};
