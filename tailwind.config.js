module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#09318d',
        panel: '#07256c',
        elevated: '#0b379c',
        line: '#5b82e0',
        'line-subtle': '#2b59c3',
        ink: '#ffffff',
        muted: '#d4cef0',
        accent: '#9d91cc',
        'on-accent': '#041236',
        danger: '#b91c1c',
        'danger-surface': '#4c1022',
        'danger-line': '#f87171',
        'danger-ink': '#fca5a5',
        success: '#86efac',
        warning: '#fde68a',
      },
      fontFamily: {
        pixel: ['GeistPixel-Square'],
        mono: ['GeistMono-Regular'],
        'mono-medium': ['GeistMono-Medium'],
        'mono-semibold': ['GeistMono-SemiBold'],
      },
    },
  },
  plugins: [],
};
