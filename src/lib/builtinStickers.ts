/**
 * Built-in sticker library: a curated set of inline SVG data URLs.
 * All SVGs use a 100×100 viewBox, transparent background, and crisp fills
 * so they scale cleanly at any size.
 */

export interface BuiltinSticker {
  id: string;
  name: string;
  src: string; // data:image/svg+xml;utf8,… URL
  category: "shapes" | "nature" | "symbols" | "fun";
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const BUILTIN_STICKERS: BuiltinSticker[] = [
  // ── Shapes ──────────────────────────────────────────────────────────────
  {
    id: "star5",
    name: "Star",
    category: "shapes",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35"
        fill="#FFD700" stroke="#E6B800" stroke-width="2"/>
    </svg>`),
  },
  {
    id: "heart",
    name: "Heart",
    category: "shapes",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M50,85 C50,85 10,55 10,30 C10,16 21,8 35,12 C42,14 47,20 50,26 C53,20 58,14 65,12 C79,8 90,16 90,30 C90,55 50,85 50,85Z"
        fill="#FF4D6D" stroke="#CC2244" stroke-width="1.5"/>
    </svg>`),
  },
  {
    id: "sparkle",
    name: "Sparkle",
    category: "shapes",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M50,5 L54,42 L90,50 L54,58 L50,95 L46,58 L10,50 L46,42 Z"
        fill="#A78BFA" stroke="#7C3AED" stroke-width="1.5"/>
      <circle cx="20" cy="20" r="4" fill="#A78BFA" opacity="0.7"/>
      <circle cx="80" cy="20" r="3" fill="#A78BFA" opacity="0.6"/>
      <circle cx="80" cy="80" r="4" fill="#A78BFA" opacity="0.7"/>
      <circle cx="20" cy="80" r="3" fill="#A78BFA" opacity="0.6"/>
    </svg>`),
  },
  {
    id: "diamond",
    name: "Diamond",
    category: "shapes",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="50,5 95,40 50,95 5,40" fill="#38BDF8" stroke="#0EA5E9" stroke-width="2"/>
      <polygon points="50,5 95,40 50,40" fill="white" opacity="0.25"/>
    </svg>`),
  },

  // ── Nature ───────────────────────────────────────────────────────────────
  {
    id: "fire",
    name: "Fire",
    category: "nature",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M50,95 C28,95 15,78 15,62 C15,44 30,34 35,20 C40,34 36,44 44,50
               C42,36 52,22 58,10 C70,28 85,44 85,62 C85,78 72,95 50,95Z"
        fill="#FF6B00"/>
      <path d="M50,95 C36,95 28,84 28,72 C28,60 38,53 40,44
               C44,52 42,60 48,64 C46,54 54,45 58,38 C66,52 72,62 72,72 C72,84 64,95 50,95Z"
        fill="#FFA500"/>
      <path d="M50,95 C42,95 38,87 38,80 C38,72 44,67 46,62 C48,67 47,72 50,74
               C53,70 56,66 58,62 C62,68 62,74 62,80 C62,87 58,95 50,95Z"
        fill="#FFD700"/>
    </svg>`),
  },
  {
    id: "lightning",
    name: "Lightning",
    category: "nature",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="58,5 20,55 45,55 42,95 80,45 55,45"
        fill="#FACC15" stroke="#CA8A04" stroke-width="2" stroke-linejoin="round"/>
    </svg>`),
  },
  {
    id: "snowflake",
    name: "Snowflake",
    category: "nature",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g stroke="#BAE6FD" stroke-width="5" stroke-linecap="round">
        <line x1="50" y1="8" x2="50" y2="92"/>
        <line x1="8" y1="50" x2="92" y2="50"/>
        <line x1="19" y1="19" x2="81" y2="81"/>
        <line x1="81" y1="19" x2="19" y2="81"/>
        <line x1="50" y1="8" x2="38" y2="22"/><line x1="50" y1="8" x2="62" y2="22"/>
        <line x1="92" y1="50" x2="78" y2="38"/><line x1="92" y1="50" x2="78" y2="62"/>
        <line x1="50" y1="92" x2="38" y2="78"/><line x1="50" y1="92" x2="62" y2="78"/>
        <line x1="8" y1="50" x2="22" y2="38"/><line x1="8" y1="50" x2="22" y2="62"/>
      </g>
      <circle cx="50" cy="50" r="6" fill="#BAE6FD"/>
    </svg>`),
  },

  // ── Symbols ──────────────────────────────────────────────────────────────
  {
    id: "crown",
    name: "Crown",
    category: "symbols",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="10,75 10,35 30,55 50,15 70,55 90,35 90,75"
        fill="#FFD700" stroke="#CA8A04" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="10" y="72" width="80" height="12" rx="3" fill="#FFD700" stroke="#CA8A04" stroke-width="2"/>
      <circle cx="50" cy="18" r="5" fill="#FF4D6D"/>
      <circle cx="10" cy="35" r="4" fill="#FF4D6D"/>
      <circle cx="90" cy="35" r="4" fill="#FF4D6D"/>
    </svg>`),
  },
  {
    id: "thumbsup",
    name: "Thumbs Up",
    category: "symbols",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M42,90 L20,90 C16,90 13,87 13,83 L13,52 C13,48 16,45 20,45 L42,45 Z"
        fill="#34D399" stroke="#059669" stroke-width="2"/>
      <path d="M42,45 L42,28 C42,20 48,14 54,14 C57,14 58,16 58,19 L58,34 L74,34
               C78,34 82,38 82,42 C82,44 81,46 80,47 C83,48 85,51 85,54 C85,57 83,60 80,61
               C82,62 84,65 84,68 C84,71 82,74 79,75 C80,76 81,78 81,80 C81,85 78,89 73,89
               L50,89 C46,89 42,87 42,84 Z"
        fill="#34D399" stroke="#059669" stroke-width="2"/>
    </svg>`),
  },
  {
    id: "checkmark",
    name: "Check",
    category: "symbols",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="44" fill="#22C55E" stroke="#16A34A" stroke-width="2"/>
      <polyline points="24,50 42,68 76,32" fill="none" stroke="white" stroke-width="9"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`),
  },

  // ── Fun ──────────────────────────────────────────────────────────────────
  {
    id: "lol",
    name: "LOL",
    category: "fun",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="44" fill="#FACC15" stroke="#CA8A04" stroke-width="2"/>
      <circle cx="35" cy="40" r="6" fill="#1E293B"/>
      <circle cx="65" cy="40" r="6" fill="#1E293B"/>
      <path d="M25,60 Q50,84 75,60" fill="#FF6B6B" stroke="#CC2244" stroke-width="2.5"
        stroke-linecap="round"/>
      <line x1="35" y1="60" x2="65" y2="60" stroke="#CC2244" stroke-width="2" stroke-dasharray="4"/>
      <path d="M30,28 Q35,22 40,28" fill="none" stroke="#1E293B" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M60,28 Q65,22 70,28" fill="none" stroke="#1E293B" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`),
  },
  {
    id: "party",
    name: "Party",
    category: "fun",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="50,10 55,80 45,80" fill="#FF6B00" stroke="#CC4400" stroke-width="1.5"/>
      <ellipse cx="50" cy="82" rx="14" ry="8" fill="#FF6B00" stroke="#CC4400" stroke-width="1.5"/>
      <circle cx="22" cy="22" r="5" fill="#FF4D6D" opacity="0.85"/>
      <circle cx="78" cy="22" r="4" fill="#38BDF8" opacity="0.85"/>
      <circle cx="15" cy="55" r="4" fill="#A78BFA" opacity="0.85"/>
      <circle cx="85" cy="55" r="5" fill="#FACC15" opacity="0.85"/>
      <circle cx="35" cy="10" r="3" fill="#34D399" opacity="0.85"/>
      <circle cx="65" cy="10" r="3" fill="#FF6B00" opacity="0.85"/>
      <line x1="22" y1="22" x2="15" y2="8" stroke="#FF4D6D" stroke-width="1.5"/>
      <line x1="78" y1="22" x2="85" y2="8" stroke="#38BDF8" stroke-width="1.5"/>
    </svg>`),
  },
  {
    id: "arrow_up",
    name: "Arrow Up",
    category: "fun",
    src: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="50,8 88,52 65,52 65,92 35,92 35,52 12,52"
        fill="#818CF8" stroke="#4F46E5" stroke-width="2" stroke-linejoin="round"/>
    </svg>`),
  },
];
