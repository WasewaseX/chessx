// Hand-built character faces for every bot and coach. Flat vector busts,
// one consistent style, each with a distinct silhouette: hats, hoods, helmets,
// fur, stone, metal. Nothing generated, nothing photographic: these are
// characters you can recognize across the app at 32px or 128px.

import { useId } from 'react'
import { cn } from '@/lib/utils'

const INK = '#33291f'

interface FaceProps {
  bg: string
  ring: string
}

/* ---------- shared feature helpers ---------- */

function Shoulders({ color, y = 46 }: { color: string; y?: number }) {
  return <path d={`M13 66 Q13 ${y} 32 ${y} Q51 ${y} 51 66 Z`} fill={color} />
}

function Neck({ skin }: { skin: string }) {
  return <rect x="28" y="38" width="8" height="8" rx="2.5" fill={skin} />
}

function Head({ skin, cx = 32, cy = 29, r = 13 }: { skin: string; cx?: number; cy?: number; r?: number }) {
  return (
    <>
      <circle cx={cx - r + 1.2} cy={cy + 1} r="2.4" fill={skin} />
      <circle cx={cx + r - 1.2} cy={cy + 1} r="2.4" fill={skin} />
      <circle cx={cx} cy={cy} r={r} fill={skin} />
    </>
  )
}

function Eyes({ cy = 29, dx = 4.6, r = 1.7, color = INK, lids = false }: { cy?: number; dx?: number; r?: number; color?: string; lids?: boolean }) {
  return (
    <g>
      {lids && (
        <g stroke={color} strokeWidth="1.6" strokeLinecap="round">
          <line x1={32 - dx - 2.2} y1={cy - 1.4} x2={32 - dx + 2.2} y2={cy - 1.4} />
          <line x1={32 + dx - 2.2} y1={cy - 1.4} x2={32 + dx + 2.2} y2={cy - 1.4} />
        </g>
      )}
      <circle cx={32 - dx} cy={cy} r={r} fill={color} />
      <circle cx={32 + dx} cy={cy} r={r} fill={color} />
    </g>
  )
}

function Brows({ cy = 24.5, dx = 4.6, tilt = 0, w = 4.6, color = INK, width = 1.8 }: { cy?: number; dx?: number; tilt?: number; w?: number; color?: string; width?: number }) {
  return (
    <g stroke={color} strokeWidth={width} strokeLinecap="round">
      <line x1={32 - dx - w / 2} y1={cy + tilt} x2={32 - dx + w / 2} y2={cy - tilt} />
      <line x1={32 + dx - w / 2} y1={cy - tilt} x2={32 + dx + w / 2} y2={cy + tilt} />
    </g>
  )
}

function Smile({ cy = 35, w = 4.4, open = false }: { cy?: number; w?: number; open?: boolean }) {
  if (open) {
    return (
      <g>
        <path d={`M${32 - w} ${cy - 1} Q32 ${cy + 5.5} ${32 + w} ${cy - 1} Z`} fill="#6e352a" />
        <path d={`M${32 - w + 0.8} ${cy - 0.8} Q32 ${cy + 0.6} ${32 + w - 0.8} ${cy - 0.8} Z`} fill="#ffffff" />
      </g>
    )
  }
  return (
    <path d={`M${32 - w} ${cy} Q32 ${cy + 3.4} ${32 + w} ${cy}`} fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
  )
}

function Blush({ opacity = 0.45, color = '#e2937b' }: { opacity?: number; color?: string }) {
  return (
    <g fill={color} opacity={opacity}>
      <circle cx="24.4" cy="32.6" r="2.1" />
      <circle cx="39.6" cy="32.6" r="2.1" />
    </g>
  )
}

/* ---------- one function per character ---------- */

function PipArt() {
  return (
    <g>
      <Shoulders color="#c9563f" />
      <Neck skin="#f6cfa2" />
      <Head skin="#f6cfa2" r={13.4} />
      {/* backwards cap */}
      <path d="M18.6 24.5 Q19 14.5 32 14.5 Q45 14.5 45.4 24.5 L18.6 24.5 Z" fill="#d8574b" />
      <path d="M43 20.5 Q51 19.5 53 24 Q49 26.5 44 25.5 Z" fill="#b8463c" />
      <circle cx="32" cy="15.2" r="1.5" fill="#b8463c" />
      <g fill="#c98a5e" opacity="0.9">
        <circle cx="24.2" cy="31.8" r="0.8" />
        <circle cx="26.6" cy="33.4" r="0.8" />
        <circle cx="25.2" cy="34.8" r="0.8" />
        <circle cx="39.8" cy="31.8" r="0.8" />
        <circle cx="37.4" cy="33.4" r="0.8" />
        <circle cx="38.8" cy="34.8" r="0.8" />
      </g>
      <Eyes cy={28.4} r={2.2} />
      <circle cx={32 - 4.6 - 0.7} cy={28.4 - 0.7} r="0.6" fill="#fff" />
      <circle cx={32 + 4.6 - 0.7} cy={28.4 - 0.7} r="0.6" fill="#fff" />
      <Brows cy={24.6} tilt={-0.6} w={4} />
      <Smile cy={35.6} w={4.8} open />
    </g>
  )
}

function MapleArt() {
  return (
    <g>
      <Shoulders color="#8f6a45" />
      <Neck skin="#f2c79b" />
      <Head skin="#f2c79b" />
      {/* grey hair + bun */}
      <circle cx="32" cy="14.6" r="5.2" fill="#cfcfcf" />
      <path d="M19 27 Q19.5 15.5 32 15.5 Q44.5 15.5 45 27 L42.5 27 Q42 19 32 19 Q22 19 21.5 27 Z" fill="#cfcfcf" />
      <g fill="none" stroke="#8f8f8f" strokeWidth="1.3">
        <circle cx="27" cy="29" r="3.6" />
        <circle cx="37" cy="29" r="3.6" />
        <path d="M30.6 29 L33.4 29" />
      </g>
      <Eyes cy={29} dx={3.4} r={1.4} />
      <Brows cy={24.8} dx={3.6} w={4} color="#9a9a9a" />
      <Smile cy={35} w={3.4} />
      <Blush opacity={0.5} />
    </g>
  )
}

function SquireArt() {
  return (
    <g>
      <Shoulders color="#7fa650" />
      <Neck skin="#e8b088" />
      <Head skin="#e8b088" />
      {/* kettle helm */}
      <path d="M18.4 25 Q19 13.5 32 13.5 Q45 13.5 45.6 25 Z" fill="#9aa3ad" />
      <ellipse cx="32" cy="25" rx="14.6" ry="2.6" fill="#7f8892" />
      <rect x="31" y="14.5" width="2" height="8" rx="1" fill="#6d757e" />
      <g fill="#6d757e">
        <circle cx="23" cy="21.5" r="0.9" />
        <circle cx="41" cy="21.5" r="0.9" />
      </g>
      <Eyes cy={29.4} dx={4.4} r={1.6} />
      <Brows cy={25.6} tilt={1.2} w={4.6} />
      <Smile cy={35.4} w={3.6} />
    </g>
  )
}

function RexArt() {
  return (
    <g>
      <Shoulders color="#a35a2c" y={47} />
      {/* collar + tag */}
      <path d="M20 47 Q32 52 44 47 L44 50 Q32 55 20 50 Z" fill="#d8574b" />
      <circle cx="32" cy="52.6" r="2.6" fill="#e8b93c" />
      {/* floppy ears behind the head */}
      <ellipse cx="19.6" cy="27" rx="4.6" ry="8.4" transform="rotate(14 19.6 27)" fill="#a35a2c" />
      <ellipse cx="44.4" cy="27" rx="4.6" ry="8.4" transform="rotate(-14 44.4 27)" fill="#a35a2c" />
      <ellipse cx="32" cy="30" rx="14.6" ry="12.8" fill="#c8763f" />
      {/* muzzle */}
      <ellipse cx="32" cy="35.4" rx="8.2" ry="5.8" fill="#f4e3cc" />
      <ellipse cx="32" cy="32.4" rx="2.6" ry="2" fill={INK} />
      <path d="M32 34.6 L32 36.4 M32 36.4 Q30 38.4 28.4 36.8 M32 36.4 Q34 38.4 35.6 36.8" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      {/* fierce little brows */}
      <g stroke={INK} strokeWidth="1.9" strokeLinecap="round">
        <line x1="24" y1="23.6" x2="29" y2="25.8" />
        <line x1="40" y1="23.6" x2="35" y2="25.8" />
      </g>
      <Eyes cy={27.8} dx={4.8} r={1.8} />
      <Blush color="#e8956a" opacity={0.35} />
    </g>
  )
}

function SentryArt() {
  return (
    <g>
      <Shoulders color="#5d9948" />
      <Neck skin="#e0ac7e" />
      <Head skin="#e0ac7e" />
      {/* watch cap */}
      <path d="M18.8 24.5 Q19.6 14 32 14 Q44.4 14 45.2 24.5 Z" fill="#43663a" />
      <rect x="18.4" y="21.5" width="27.2" height="4" rx="2" fill="#365429" />
      {/* goggles pushed up on the forehead */}
      <g fill="none" stroke="#2c3a26" strokeWidth="1.6">
        <circle cx="27.4" cy="18.6" r="3.1" fill="#cfe0c4" />
        <circle cx="36.6" cy="18.6" r="3.1" fill="#cfe0c4" />
        <path d="M30.5 18.6 L33.5 18.6" />
      </g>
      <Eyes cy={29.6} dx={4.4} r={1.4} lids />
      <Brows cy={26.4} dx={4.4} tilt={0.4} w={4.4} />
      <path d="M29.4 35.6 L34.6 35.6" stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
    </g>
  )
}

function VanguardArt() {
  return (
    <g>
      <Shoulders color="#4f8f4a" />
      <Neck skin="#d9a06b" />
      <Head skin="#d9a06b" cy={30.4} r={12.6} />
      {/* army helmet */}
      <path d="M18 27 Q18.4 15.5 32 15.5 Q45.6 15.5 46 27 Z" fill="#6b7a4f" />
      <path d="M17 27 Q32 24.4 47 27 L47 29.4 Q32 26.8 17 29.4 Z" fill="#57643f" />
      <circle cx="32" cy="20.6" r="1.6" fill="#e8e4d8" />
      <path d="M25 40.5 Q32 43.4 39 40.5" fill="none" stroke="#57643f" strokeWidth="1.4" />
      <Eyes cy={31.6} dx={4.2} r={1.5} />
      <Brows cy={27.8} dx={4.2} tilt={1.6} w={4.8} width={2} />
      <path d="M28.8 37 L35.2 37" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </g>
  )
}

function FortressArt() {
  return (
    <g>
      <Shoulders color="#6f6f68" />
      <Neck skin="#d9a06b" />
      <Head skin="#d9a06b" />
      {/* stone hood */}
      <path d="M17.4 30 Q17 13.5 32 13.5 Q47 13.5 46.6 30 L41.6 30 Q42 18.6 32 18.6 Q22 18.6 22.4 30 Z" fill="#8a8a80" />
      <g stroke="#77776e" strokeWidth="1.2">
        <path d="M20.4 22 L25 20" />
        <path d="M43.6 22 L39 20" />
      </g>
      <Eyes cy={29.8} dx={4.4} r={1.5} />
      <path d="M25.4 26.2 L29.4 26.2 M34.6 26.2 L38.6 26.2" stroke={INK} strokeWidth="2.1" strokeLinecap="round" />
      <path d="M29.2 35.8 L34.8 35.8" stroke={INK} strokeWidth="1.9" strokeLinecap="round" />
    </g>
  )
}

function CornerstoneArt() {
  return (
    <g>
      <Shoulders color="#3f7d8c" />
      <Neck skin="#f2c79b" />
      <Head skin="#f2c79b" />
      {/* hard hat */}
      <path d="M19 23.5 Q20 13.5 32 13.5 Q44 13.5 45 23.5 Z" fill="#e8b93c" />
      <ellipse cx="32" cy="23.5" rx="15.4" ry="2.8" fill="#c99a26" />
      <rect x="29.5" y="13.5" width="5" height="6" rx="2" fill="#c99a26" />
      <g fill="none" stroke="#5a4634" strokeWidth="1.4">
        <rect x="24" y="28.2" width="6" height="4.4" rx="1" />
        <rect x="34" y="28.2" width="6" height="4.4" rx="1" />
        <path d="M30 30.2 L34 30.2" />
      </g>
      <Eyes cy={30.4} dx={3.4} r={1.3} />
      <Brows cy={26.2} dx={3.6} w={4} color="#7a6a52" />
      <Smile cy={35.6} w={3.2} />
    </g>
  )
}

function TacticianArt() {
  return (
    <g>
      <Shoulders color="#c9742e" />
      <Neck skin="#e8b088" />
      <Head skin="#e8b088" />
      {/* spiky hair */}
      <path d="M18.8 26 Q18 14 32 13.6 Q46 14 45.2 26 L43 22 L40.6 25 L37.6 20.6 L34.4 24 L32 19 L29.4 24 L26.2 20.6 L23.2 25 L21 22 Z" fill="#3d2b1f" />
      {/* headband */}
      <rect x="18.8" y="22.6" width="26.4" height="4.4" rx="2.2" fill="#e8862e" />
      <path d="M44 24.8 Q48.6 24 50.6 27.4 Q47 29 43.6 27.4 Z" fill="#e8862e" />
      <Eyes cy={30.4} dx={4.4} r={1.7} />
      <Brows cy={27} dx={4.4} tilt={2} w={5} width={2} />
      <Smile cy={35.8} w={4.2} open />
    </g>
  )
}

function StrategistArt() {
  return (
    <g>
      <Shoulders color="#35597a" />
      <Neck skin="#f2c79b" />
      <Head skin="#f2c79b" />
      {/* neat side part */}
      <path d="M19 27.4 Q18.4 14.4 32 14 Q45.6 14.4 45 27.4 L42.6 27 Q43 18.4 32 18.2 Q22.4 18.4 21.6 26 Q20.4 24.4 19 27.4 Z" fill="#3a4453" />
      <g fill="none" stroke="#2f2a24" strokeWidth="1.5">
        <rect x="23.8" y="28" width="6.8" height="4.8" rx="1.2" />
        <rect x="33.4" y="28" width="6.8" height="4.8" rx="1.2" />
        <path d="M30.6 30 L33.4 30" />
      </g>
      <Eyes cy={30.4} dx={3.8} r={1.3} />
      <Brows cy={26.6} dx={3.8} w={4.4} color="#3a4453" />
      <Smile cy={35.8} w={3} />
    </g>
  )
}

function NyxArt() {
  return (
    <g>
      <Shoulders color="#23232b" />
      {/* hood mass hugging a pale face, with a peak above */}
      <path d="M11.5 42 Q9.5 12.5 32 11.5 Q54.5 12.5 52.5 42 L45 42 Q48.5 22 32 21.5 Q15.5 22 19 42 Z" fill="#2f2f38" />
      <circle cx="32" cy="13.2" r="2" fill="#454550" />
      <circle cx="32" cy="30.5" r="13.6" fill="#e6e2ea" />
      {/* pale glow eyes */}
      <circle cx={32 - 4.6} cy={29.4} r="3.1" fill="#b9a7ff" opacity="0.3" />
      <circle cx={32 + 4.6} cy={29.4} r="3.1" fill="#b9a7ff" opacity="0.3" />
      <Eyes cy={29.4} dx={4.6} r={1.8} color="#3d3450" />
      <path d="M29.8 36.4 Q32 37.4 34.2 36.4" fill="none" stroke="#a9a2b8" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  )
}

function GrandmasterArt() {
  return (
    <g>
      <Shoulders color="#5b4a68" />
      <Neck skin="#efc9a6" />
      <Head skin="#efc9a6" />
      {/* thin white hair ring, face stays dominant */}
      <path d="M19.8 28.5 Q19.4 16.8 32 16.8 Q44.6 16.8 44.2 28.5 L41.6 28.5 Q42 20 32 20 Q22 20 22.4 28.5 Z" fill="#e4e4e4" />
      <circle cx="20.6" cy="27.4" r="2.6" fill="#e4e4e4" />
      <circle cx="43.4" cy="27.4" r="2.6" fill="#e4e4e4" />
      {/* trimmed white beard */}
      <path d="M23 33 Q24 42 28.4 44.4 Q32 46.2 35.6 44.4 Q40 42 41 33 Q37.6 36.6 32 36.6 Q26.4 36.6 23 33 Z" fill="#e4e4e4" />
      <path d="M28.8 35.6 Q32 37.4 35.2 35.6" fill="none" stroke="#b5b5b5" strokeWidth="1.2" strokeLinecap="round" />
      <Eyes cy={28} dx={4.4} r={1.5} />
      <Brows cy={24.6} dx={4.4} w={4.4} color="#cfcfcf" width={2.2} />
      <path d="M28.4 33.2 Q32 34.8 35.6 33.2" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
    </g>
  )
}

function TitanArt() {
  return (
    <g>
      <Shoulders color="#5c5c64" y={44} />
      <Neck skin="#8f948d" />
      {/* angular stone head */}
      <path d="M32 13.6 L44.6 19.4 L47 33 L41.6 44 L22.4 44 L17 33 L19.4 19.4 Z" fill="#8f948d" />
      <path d="M32 13.6 L44.6 19.4 L47 33 L41.6 44 L22.4 44 L17 33 L19.4 19.4 Z" fill="none" stroke="#77796f" strokeWidth="1.4" strokeLinejoin="round" />
      {/* cracks */}
      <g stroke="#6f7168" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M24 20 L27.6 24.4 L25 28.6" />
        <path d="M41 36 L38 39.4 L39.6 42.4" />
        <path d="M38.6 18.8 L36.4 22.6" />
      </g>
      {/* moss */}
      <path d="M27 15.4 Q29 13.8 31.4 14.4 M35 14.6 Q37.6 14.2 39.4 16.4" stroke="#6f8f4a" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* glowing amber eyes in dark sockets */}
      <g>
        <rect x="23.4" y="27.6" width="7.2" height="4.6" rx="2.3" fill="#4a4a42" />
        <rect x="33.4" y="27.6" width="7.2" height="4.6" rx="2.3" fill="#4a4a42" />
        <rect x="25" y="29" width="4" height="1.9" rx="0.95" fill="#ffb84d" />
        <rect x="35" y="29" width="4" height="1.9" rx="0.95" fill="#ffb84d" />
      </g>
      <path d="M28 38.4 L36 38.4" stroke="#4a4a42" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

function MaximumArt() {
  return (
    <g>
      <Shoulders color="#232329" y={45} />
      <rect x="28.4" y="36" width="7.2" height="7" rx="2" fill="#38383f" />
      {/* head unit */}
      <rect x="19.4" y="16.6" width="25.2" height="26" rx="6.5" fill="#4a4a54" stroke="#1c1c22" strokeWidth="1.6" />
      <line x1="32" y1="16.6" x2="32" y2="11" stroke="#1c1c22" strokeWidth="1.6" />
      <circle cx="32" cy="9.8" r="1.8" fill="#81b64c" />
      {/* visor */}
      <rect x="22.4" y="24.2" width="19.2" height="9" rx="4.5" fill="#101014" />
      <rect x="24.6" y="27.4" width="14.8" height="2.6" rx="1.3" fill="#8fbc52" />
      {/* side bolts */}
      <circle cx="21.8" cy="36.6" r="1.3" fill="#6d6d78" />
      <circle cx="42.2" cy="36.6" r="1.3" fill="#6d6d78" />
      <path d="M27 39.6 L37 39.6" stroke="#6d6d78" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  )
}

/* ---------- coaches ---------- */

function NinaArt() {
  return (
    <g>
      <Shoulders color="#5d9948" />
      {/* scarf */}
      <path d="M20 46.5 Q32 51.5 44 46.5 L44 51 Q32 56 20 51 Z" fill="#43663a" />
      <Neck skin="#f6cfa2" />
      <Head skin="#f6cfa2" />
      {/* warm bob */}
      <path d="M18.6 32 Q17.4 14.4 32 14.4 Q46.6 14.4 45.4 32 L40.6 32 Q42 20.4 32 20.4 Q22 20.4 23.4 32 Z" fill="#6b4a32" />
      <path d="M20 27.4 Q23 18 32 18 Q41 18 44 27.4 L42.6 28 Q39.6 21.6 32 21.6 Q24.4 21.6 21.4 28 Z" fill="#7d573c" />
      <Eyes cy={29} dx={4.4} r={1.7} />
      <circle cx={32 - 4.4 - 0.7} cy={29 - 0.7} r="0.6" fill="#fff" />
      <circle cx={32 + 4.4 - 0.7} cy={29 - 0.7} r="0.6" fill="#fff" />
      <Brows cy={25} dx={4.4} tilt={-0.8} w={4.4} />
      <Smile cy={35.2} w={3.8} />
      <Blush />
    </g>
  )
}

function VictorArt() {
  return (
    <g>
      <Shoulders color="#d97b29" />
      <Neck skin="#e8b088" />
      <Head skin="#e8b088" />
      {/* short spikes */}
      <path d="M19.4 25.4 Q19.6 15 32 14.6 Q44.4 15 44.6 25.4 L42 23.4 L39.4 20.8 L36.6 23 L34 19.6 L31 22.8 L28.4 19.8 L25.4 23 L22.6 20.8 L20.6 23.4 Z" fill="#2e2620" />
      {/* sweatband */}
      <rect x="19" y="22.8" width="26" height="4.6" rx="2.3" fill="#c9563f" />
      <Eyes cy={29.8} dx={4.4} r={1.7} />
      <Brows cy={26} dx={4.4} tilt={-1.4} w={4.8} width={2} />
      <Smile cy={35.4} w={4.4} open />
      {/* stubble */}
      <g fill="#5a4634" opacity="0.55">
        <circle cx="26" cy="36.4" r="0.55" />
        <circle cx="28.4" cy="38" r="0.55" />
        <circle cx="35.6" cy="38" r="0.55" />
        <circle cx="38" cy="36.4" r="0.55" />
        <circle cx="32" cy="39.2" r="0.55" />
      </g>
    </g>
  )
}

function ElenaArt() {
  return (
    <g>
      <Shoulders color="#2f7a74" />
      {/* collar */}
      <path d="M25 46 L32 52.4 L39 46 L39 50 L32 56 L25 50 Z" fill="#f0ede4" />
      <Neck skin="#efc9a6" />
      <Head skin="#efc9a6" />
      {/* pulled back hair + bun */}
      <circle cx="32" cy="14.2" r="4.6" fill="#3a2f2a" />
      <path d="M19.6 28 Q19 15.4 32 15.4 Q45 15.4 44.4 28 L40.8 28 Q41.4 19.6 32 19.6 Q22.6 19.6 23.2 28 Z" fill="#3a2f2a" />
      <g fill="none" stroke="#4a3f38" strokeWidth="1.5">
        <circle cx="27.2" cy="29.6" r="3.8" />
        <circle cx="36.8" cy="29.6" r="3.8" />
        <path d="M31 29.6 L33 29.6" />
      </g>
      <Eyes cy={29.6} dx={3.6} r={1.4} />
      <Brows cy={25.4} dx={3.8} w={4.4} color="#4a3f38" />
      <Smile cy={35.6} w={3.2} />
      <Blush opacity={0.3} />
    </g>
  )
}

function SashaArt() {
  return (
    <g>
      <Shoulders color="#3f3a35" />
      <Neck skin="#e0ac7e" />
      <Head skin="#e0ac7e" />
      {/* slicked grey hair */}
      <path d="M19.4 26.6 Q18.8 14.6 32 14.6 Q45.2 14.6 44.6 26.6 L42 26 Q43 18.6 32 18.6 Q21 18.6 22 26 Z" fill="#8d8d8d" />
      <path d="M32 16.6 Q40 16.8 43.4 23.4 L42 24 Q38.6 18.4 32 18.4 Z" fill="#a5a5a5" />
      {/* short beard */}
      <path d="M22.8 32.6 Q23.4 42 28.6 44.6 Q32 46.4 35.4 44.6 Q40.6 42 41.2 32.6 Q38 36.6 32 36.6 Q26 36.6 22.8 32.6 Z" fill="#9a9a9a" />
      {/* gold rim glasses */}
      <g fill="none" stroke="#c9a13b" strokeWidth="1.6">
        <circle cx="27.2" cy="29.4" r="3.9" />
        <circle cx="36.8" cy="29.4" r="3.9" />
        <path d="M31.1 29.4 L32.9 29.4" />
      </g>
      <Eyes cy={29.4} dx={3.6} r={1.4} />
      <Brows cy={25} dx={3.8} w={4.8} color="#8d8d8d" width={2.2} />
      {/* dry half smirk */}
      <path d="M29 35.8 Q32.6 37.6 35.8 35" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
    </g>
  )
}

/* ---------- registry + renderer ---------- */

interface Art {
  bg: string
  ring: string
  initials: string
  ink?: string
  art: () => React.ReactNode
}

const REGISTRY: Record<string, Art> = {
  pip: { bg: '#ecdfc0', ring: '#d3c19a', initials: 'P', art: PipArt },
  maple: { bg: '#f0e4cd', ring: '#d8c8a8', initials: 'M', art: MapleArt },
  squire: { bg: '#e2e8d4', ring: '#c2ccab', initials: 'S', art: SquireArt },
  rex: { bg: '#f2ddca', ring: '#d9bc9f', initials: 'R', art: RexArt },
  sentry: { bg: '#dbe6d3', ring: '#bccfb0', initials: 'S', art: SentryArt },
  vanguard: { bg: '#dde5cb', ring: '#bfc9a4', initials: 'V', art: VanguardArt },
  fortress: { bg: '#e6e4df', ring: '#c8c6bf', initials: 'F', art: FortressArt },
  cornerstone: { bg: '#e0e8eb', ring: '#c0ccd1', initials: 'C', art: CornerstoneArt },
  tactician: { bg: '#f4e5d2', ring: '#dcc4a6', initials: 'T', art: TacticianArt },
  strategist: { bg: '#dfe5ec', ring: '#c0c8d3', initials: 'S', art: StrategistArt },
  nyx: { bg: '#3a3a46', ring: '#23232c', initials: 'N', ink: '#f4f2f8', art: NyxArt },
  grandmaster: { bg: '#eae3ef', ring: '#cfc3da', initials: 'G', art: GrandmasterArt },
  titan: { bg: '#e1e5e2', ring: '#c2c7c3', initials: 'T', art: TitanArt },
  maximum: { bg: '#2b2b30', ring: '#15151a', initials: 'M', ink: '#a8e07a', art: MaximumArt },
  nina: { bg: '#e6eedb', ring: '#c6d6b3', initials: 'N', art: NinaArt },
  victor: { bg: '#f5e7d6', ring: '#dcc3a4', initials: 'V', art: VictorArt },
  elena: { bg: '#dce9e8', ring: '#bccfcc', initials: 'E', art: ElenaArt },
  sasha: { bg: '#ede6d3', ring: '#d2c8ae', initials: 'S', art: SashaArt },
}

function Initials({ label, bg, ring, ink }: { label: string; bg: string; ring: string; ink?: string }) {
  return (
    <g>
      <circle cx="32" cy="32" r="31" fill={bg} stroke={ring} strokeWidth="2" />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="22"
        fontWeight="800"
        fontFamily="var(--font-display, sans-serif)"
        fill={ink ?? INK}
      >
        {label.slice(0, 2).toUpperCase()}
      </text>
    </g>
  )
}

/**
 * A character face that fills its container. Put sizing and border-radius on
 * the wrapping element via className (the svg scales to it).
 */
export function CharacterFace({ id, label, className }: { id: string; label?: string; className?: string }) {
  const spec = REGISTRY[id]
  const clipId = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="0 0 64 64" className={cn('block h-full w-full', className)} role="img" aria-label={label ?? id}>
      {spec ? (
        <>
          <circle cx="32" cy="32" r="31" fill={spec.bg} stroke={spec.ring} strokeWidth="2" />
          <clipPath id={clipId}>
            <circle cx="32" cy="32" r="30" />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>{spec.art()}</g>
        </>
      ) : (
        <Initials label={label ?? id} bg="#e5e2da" ring="#cfcac0" />
      )}
    </svg>
  )
}

export function hasCharacter(id: string): boolean {
  return id in REGISTRY
}
