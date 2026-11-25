import Svg, { Path } from 'react-native-svg';

const PIXEL_PATHS = {
  mic: [
    'M10 2h4v2h-4zM8 4h2v10H8zm2 10h4v2h-4zm4-10h2v10h-2zM4 10h2v6H4zm2 6h2v2H6zm2 2h8v2H8zm8-2h2v2h-2zm2-6h2v6h-2zm-7 10h2v2h-2z',
  ],
  play: ['M8 5h2v14H8zm2 2h2v10h-2zm2 2h2v6h-2zm2 2h2v2h-2z'],
  square: ['M2 4h2v16H2zm2 16h16v2H4zM20 4h2v16h-2zM4 2h16v2H4z'],
  search: [
    'M22 22h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-6-2H6v-2h8v2Zm4 0h-2v-2h2v2ZM6 16H4v-2h2v2Zm10 0h-2v-2h2v2ZM4 14H2V6h2v8Zm14 0h-2V6h2v8ZM6 6H4V4h2v2Zm10 0h-2V4h2v2Zm-2-2H6V2h8v2Z',
  ],
  zap: [
    'M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z',
  ],
  archive: [
    'M3 2h18v2H3zm0 5h18v2H3zM1 4h2v3H1zm20 0h2v3h-2zm-2 5h2v11h-2zM3 9h2v11H3zm2 11h14v2H5zm4-9h6v2H9z',
  ],
  check: [
    'M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z',
  ],
  checkbox: ['M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2z'],
  'checkbox-on': [
    'M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM7 12h2v2H7zm2 2h2v2H9zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2z',
  ],
  trash: ['M18 22H6V20H18V22ZM9 6H15V4H17V6H22V8H20V20H18V8H6V20H4V8H2V6H7V4H9V6ZM15 4H9V2H15V4Z'],
  download: [
    'M21 15v4h-2v-4zm-2 4v2H5v-2zM5 15v4H3v-4zm8-12v14h-2V3z',
    'M7 11v2h10v-2zm2 2v2h2v-2zm4 0v2h2v-2z',
    'M15 11v2h2v-2z',
  ],
  plus: ['M13 11h7v2h-7v7h-2v-7H4v-2h7V4h2v7Z'],
  'arrow-right': [
    'M4 11v2h16v-2zm12 2v2h2v-2zm-2 2v2h2v-2zm-2 2v2h2v-2zm4-6V9h2v2z',
    'M14 15V7h2v8zm-2 2V5h2v12z',
  ],
  close: [
    'M7 19H5V17H7V19ZM19 19H17V17H19V19ZM9 15V17H7V15H9ZM17 17H15V15H17V17ZM11 15H9V13H11V15ZM15 15H13V13H15V15ZM13 13H11V11H13V13ZM11 11H9V9H11V11ZM15 11H13V9H15V11ZM9 9H7V7H9V9ZM17 9H15V7H17V9ZM7 7H5V5H7V7ZM19 7H17V5H19V7Z',
  ],
  clock: [
    'M6 2h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zM4 4h2v2H4zm2 18h12v-2H6zm12-2h2v-2h-2zM4 20h2v-2H4zm7-14h2v7h-2zm2 7h2v2h-2zm2 2h2v2h-2z',
  ],
  lock: ['M5 8h14v2H5zm0 12h14v2H5zM3 10h2v10H3zm16 0h2v10h-2zM7 4h2v4H7zm2-2h6v2H9zm6 2h2v4h-2z'],
  notes: [
    'M6 8h2v12H6zM2 4h2v12H2zm18 4h2v8h-2zM8 6h12v2H8zM4 2h12v2H4zm14 14h2v2h-2zm-2 2h2v2h-2zm-8 2h8v2H8zm6-6h6v2h-6z',
    'M14 14h2v6h-2zm2-10h2v2h-2zM4 16h2v2H4z',
  ],
  sliders: [
    'M8 14H7v6H5v-6H2v-2h6v2Zm5 6h-2V10h2v10Zm9-2h-3v2h-2v-2h-1v-2h6v2Zm-3-4h-2V4h2v10ZM7 10H5V4h2v6Zm6-4h2v2H9V6h2V4h2v2Z',
  ],
  'info-box': ['M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-9 5h2V7h-2zm0 8h2v-6h-2z'],
  edit: [
    'M16 2h4v2h-4zM20 4h2v4h-2zM14 4h2v2h-2zM12 6h2v2h-2zM10 8h2v2h-2zM8 10h2v2H8zM6 12h2v2H6zM4 14h2v2H4zM2 16h2v6H2zM4 20h4v2H4zM8 18h2v2H8zM10 16h2v2h-2zM12 14h2v2h-2zM14 12h2v2h-2zM16 10h2v2h-2zM18 8h2v2h-2zM14 6h2v2h-2zM16 8h2v2h-2z',
  ],
  refresh: [
    'M6 4h10v2H6zM4 6h2v4H4zM14 2h2v2h-2zM16 4h2v2h-2zM14 6h2v2h-2zM8 18h10v2H8zM18 14h2v4h-2zM8 16h2v2H8zM6 18h2v2H6zM8 20h2v2H8z',
  ],
} as const;

export type PixelIconName = keyof typeof PIXEL_PATHS;

export function MonoLogo({ height = 20, color = '#ffffff' }: { height?: number; color?: string }) {
  const width = Math.round((height * 53) / 20.5);
  return (
    <Svg width={width} height={height} viewBox="-0.5 -0.5 53 20.5" fill="none">
      <Path
        d="M11.1533 0.999624V18.0156H9.56925V2.65562H6.97725V18.0156H5.32125V2.65562H2.70525V18.0156H1.00125V0.999624H11.1533ZM24.1948 0.999624V18.0156H14.0428V0.999624H24.1948ZM15.8188 16.2396H22.5388V2.65562H15.8188V16.2396ZM37.2364 0.999624V18.0156H35.6524V2.65562H28.7884V18.0156H27.0844V0.999624H37.2364ZM50.2779 0.999624V18.0156H40.1259V0.999624H50.2779ZM41.9019 16.2396H48.6219V2.65562H41.9019V16.2396Z"
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="miter"
      />
    </Svg>
  );
}

export function PixelIcon({
  name,
  size = 24,
  color = '#ffffff',
}: {
  name: PixelIconName;
  size?: 16 | 24;
  color?: string;
}) {
  const paths = PIXEL_PATHS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {paths.map((d, idx) => (
        <Path key={idx} d={d} fill={color} />
      ))}
    </Svg>
  );
}
