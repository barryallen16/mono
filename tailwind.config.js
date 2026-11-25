module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#09318d',
        panel: '#07256c',
        line: '#1f4ab2',
        ink: '#ffffff',
        muted: '#d4cef0',
        accent: '#9d91cc',
        danger: '#ef4444',
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
