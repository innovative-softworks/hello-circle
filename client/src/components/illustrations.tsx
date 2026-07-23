import { colors } from "../theme";

// Hand-built flat-style SVG illustrations (no external image assets) used on
// the vendor/admin dashboard hero panels and the community/sports category
// cards. Each is a self-contained foreground graphic — the soft blob
// background is supplied by whatever panel renders it.

const GREEN = colors.green;
const GREEN_DARK = colors.greenDark;
const GREEN_LIGHT = "#BFE0CD";
const CREAM = "#F3EEE1";
const TAN = "#E7DFC9";

function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={-3} y={18} width={6} height={16} rx={2} fill="#8C6F4E" />
      <circle cx={0} cy={6} r={17} fill={GREEN_LIGHT} />
      <circle cx={-9} cy={12} r={12} fill={GREEN} />
      <circle cx={9} cy={12} r={12} fill={GREEN} />
      <circle cx={0} cy={0} r={15} fill={GREEN} />
    </g>
  );
}

export function AdminIllustration() {
  return (
    <svg viewBox="0 0 300 180" width="100%" height="100%" role="img" aria-label="Admin analytics illustration">
      <defs>
        <linearGradient id="admin-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor={GREEN_LIGHT} stopOpacity={0.35} />
        </linearGradient>
        <linearGradient id="admin-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN_DARK} />
          <stop offset="100%" stopColor={GREEN} />
        </linearGradient>
        <linearGradient id="admin-pot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN} />
          <stop offset="100%" stopColor={GREEN_DARK} />
        </linearGradient>
      </defs>

      <ellipse cx={150} cy={158} rx={128} ry={9} fill="#DCE8DF" opacity={0.55} />

      {/* clipboard */}
      <g transform="translate(18 46)">
        <rect x={0} y={0} width={58} height={92} rx={9} fill={GREEN_LIGHT} fillOpacity={0.4} stroke={GREEN} strokeWidth={2.5} />
        <rect x={17} y={-8} width={24} height={14} rx={5} fill={GREEN} />
        {[16, 34, 52, 70].map((yy) => (
          <g key={yy}>
            <circle cx={14} cy={yy} r={5} fill="#fff" stroke={GREEN} strokeWidth={1.5} />
            <path d={`M11.5 ${yy} l1.8 1.8 l3.2 -3.6`} stroke={GREEN_DARK} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <rect x={26} y={yy - 2.5} width={24} height={5} rx={2.5} fill="#fff" />
          </g>
        ))}
      </g>

      {/* monitor */}
      <g transform="translate(96 14)">
        <rect x={0} y={0} width={148} height={102} rx={12} fill={GREEN_DARK} />
        <rect x={8} y={8} width={132} height={78} rx={5} fill="url(#admin-screen)" />
        <circle cx={16} cy={16} r={2} fill="#E8622A" />
        <circle cx={23} cy={16} r={2} fill={colors.gold} />
        <circle cx={30} cy={16} r={2} fill={GREEN} />
        <rect x={16} y={24} width={46} height={6} rx={3} fill={colors.border} />
        <rect x={16} y={68} width={30} height={8} rx={4} fill={GREEN_LIGHT} />
        {/* bar chart */}
        {[
          { x: 16, h: 14 },
          { x: 27, h: 22 },
          { x: 38, h: 30 },
          { x: 49, h: 40 },
        ].map((b) => (
          <rect key={b.x} x={b.x} y={58 - b.h} width={8} height={b.h} rx={2} fill="url(#admin-bar)" />
        ))}
        {/* pie chart */}
        <circle cx={104} cy={40} r={22} fill={GREEN_LIGHT} />
        <path d="M104 40 L104 18 A22 22 0 0 1 123.7 51 Z" fill={GREEN_DARK} />
        <circle cx={104} cy={40} r={22} fill="none" stroke="#fff" strokeWidth={1.5} />
        <rect x={70} y={70} width={60} height={4} rx={2} fill={colors.border} />
        {/* stand */}
        <rect x={66} y={102} width={16} height={12} fill={GREEN_DARK} />
        <rect x={50} y={112} width={48} height={7} rx={3.5} fill={GREEN_DARK} />
      </g>

      {/* plant */}
      <g transform="translate(256 100)">
        <path d="M-16 46 L-11 22 L11 22 L16 46 Z" fill="url(#admin-pot)" />
        <rect x={-19} y={17} width={38} height={8} rx={4} fill={GREEN} />
        <line x1={0} y1={22} x2={0} y2={-6} stroke={GREEN_DARK} strokeWidth={3} strokeLinecap="round" />
        <ellipse cx={-14} cy={-8} rx={13} ry={9} fill={GREEN} transform="rotate(-35 -14 -8)" />
        <ellipse cx={14} cy={-16} rx={13} ry={9} fill={GREEN} transform="rotate(30 14 -16)" />
        <ellipse cx={0} cy={-30} rx={10} ry={14} fill={GREEN_DARK} />
      </g>
    </svg>
  );
}

export function VendorIllustration() {
  const stripes = Array.from({ length: 7 }, (_, i) => i);
  return (
    <svg viewBox="0 0 300 180" width="100%" height="100%" role="img" aria-label="Vendor storefront illustration">
      <defs>
        <linearGradient id="vendor-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor={CREAM} />
        </linearGradient>
        <linearGradient id="vendor-awning" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN_DARK} />
          <stop offset="100%" stopColor={GREEN} />
        </linearGradient>
      </defs>

      <ellipse cx={150} cy={158} rx={110} ry={8} fill="#DCE8DF" opacity={0.6} />
      <Tree x={44} y={72} scale={1.05} />
      <Tree x={252} y={78} scale={0.9} />
      <Tree x={218} y={60} scale={0.7} />

      {/* building body */}
      <rect x={80} y={72} width={140} height={82} fill="url(#vendor-wall)" stroke={TAN} strokeWidth={1.5} />

      {/* awning */}
      <g>
        <path d="M72 72 L228 72 L216 44 L84 44 Z" fill="url(#vendor-awning)" />
        {stripes.map((i) => (
          <path key={i} d={`M${84 + i * 20.6} 44 L${76 + i * 22.3} 72 L${96 + i * 22.3} 72 Z`} fill={i % 2 === 0 ? "#fff" : GREEN_DARK} />
        ))}
        {/* scalloped edge */}
        {Array.from({ length: 8 }, (_, i) => (
          <circle key={i} cx={76 + i * 21.7} cy={73} r={5} fill="#fff" />
        ))}
      </g>

      {/* door (left) */}
      <rect x={98} y={104} width={34} height={50} rx={2} fill={GREEN_DARK} />
      <rect x={105} y={112} width={20} height={24} rx={1} fill="#EAF3F7" opacity={0.85} />
      <line x1={106} y1={134} x2={122} y2={114} stroke="#fff" strokeWidth={1.4} opacity={0.5} />
      <circle cx={126} cy={130} r={1.8} fill={colors.gold} />

      {/* window (right) with sill planting */}
      <rect x={150} y={96} width={56} height={40} rx={2} fill="#EAF3F7" stroke={TAN} strokeWidth={2} />
      <line x1={178} y1={96} x2={178} y2={136} stroke={TAN} strokeWidth={2} />
      <line x1={150} y1={116} x2={206} y2={116} stroke={TAN} strokeWidth={2} />
      <line x1={155} y1={112} x2={172} y2={100} stroke="#fff" strokeWidth={2} opacity={0.55} />
      <rect x={148} y={134} width={60} height={7} rx={3} fill={GREEN_DARK} />
      <circle cx={160} cy={132} r={7} fill={GREEN} />
      <circle cx={172} cy={130} r={8} fill={GREEN} />
      <circle cx={185} cy={132} r={7} fill={GREEN} />
    </svg>
  );
}

export function CommunityIllustration() {
  return (
    <svg viewBox="0 0 300 180" width="100%" height="100%" role="img" aria-label="Community centre illustration">
      <defs>
        <linearGradient id="community-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor={CREAM} />
        </linearGradient>
        <linearGradient id="community-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#EAF3F7" />
          <stop offset="100%" stopColor={GREEN_LIGHT} />
        </linearGradient>
      </defs>

      <ellipse cx={152} cy={160} rx={126} ry={9} fill="#DCE8DF" opacity={0.55} />
      <Tree x={30} y={90} scale={1.05} />
      <Tree x={272} y={84} scale={0.9} />

      {/* low wing (left, angled roof) */}
      <path d="M60 108 L60 152 L128 152 L128 96 Z" fill="url(#community-wall)" stroke={TAN} strokeWidth={1.5} />
      <path d="M56 108 L128 96 L128 90 L60 102 Z" fill={GREEN} />
      <rect x={72} y={118} width={30} height={30} fill="url(#community-glass)" stroke={TAN} strokeWidth={1.5} />
      <line x1={87} y1={118} x2={87} y2={148} stroke={TAN} strokeWidth={1.2} />

      {/* main block */}
      <rect x={128} y={68} width={110} height={84} fill="url(#community-wall)" stroke={TAN} strokeWidth={1.5} />
      <rect x={124} y={62} width={118} height={9} rx={2} fill={GREEN} />

      {/* big window (right) */}
      <rect x={196} y={86} width={34} height={62} fill="url(#community-glass)" stroke={TAN} strokeWidth={1.5} />
      <line x1={213} y1={86} x2={213} y2={148} stroke={TAN} strokeWidth={1.2} />
      <line x1={196} y1={112} x2={230} y2={112} stroke={TAN} strokeWidth={1.2} />
      <line x1={199} y1={108} x2={210} y2={90} stroke="#fff" strokeWidth={2} opacity={0.5} />

      {/* entrance */}
      <path d="M148 108 L148 92 L188 92 L188 108 Z" fill={GREEN} />
      <rect x={150} y={108} width={36} height={44} fill={GREEN_DARK} />
      <line x1={168} y1={108} x2={168} y2={152} stroke="#EAF3F7" strokeWidth={1.4} opacity={0.7} />
      <rect x={155} y={116} width={10} height={2} rx={1} fill="#EAF3F7" />
      <rect x={171} y={116} width={10} height={2} rx={1} fill="#EAF3F7" />
      {/* people signage above the door */}
      <rect x={149} y={72} width={38} height={16} rx={3} fill="#fff" stroke={TAN} strokeWidth={1.2} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${160 + i * 8.5} 80)`}>
          <circle cx={0} cy={-2.6} r={2.4} fill={GREEN} />
          <path d="M-3.4 3.6c0-3 1.6-4.6 3.4-4.6s3.4 1.6 3.4 4.6Z" fill={GREEN} />
        </g>
      ))}

      {/* freestanding sign */}
      <rect x={200} y={122} width={42} height={28} rx={2.5} fill="#fff" stroke={TAN} strokeWidth={1.3} />
      <text x={221} y={133} textAnchor="middle" fontSize={6.2} fontWeight={800} fontFamily="sans-serif" fill={GREEN_DARK}>
        COMMUNITY
      </text>
      <text x={221} y={141} textAnchor="middle" fontSize={6.2} fontWeight={800} fontFamily="sans-serif" fill={GREEN_DARK}>
        CENTRE
      </text>
      <rect x={216} y={145} width={10} height={2} rx={1} fill={colors.border} />
      <rect x={216} y={148.5} width={7} height={2} rx={1} fill={colors.border} />
      <rect x={218} y={150} width={6} height={9} fill={TAN} />

      {/* bushes along the base */}
      {[80, 108, 200, 236].map((bx, i) => (
        <ellipse key={bx} cx={bx} cy={153} rx={12 - (i % 2) * 2} ry={7} fill={GREEN_LIGHT} opacity={0.8} />
      ))}
    </svg>
  );
}

function WalkingFigure({ x, hair, top, bottom, skin = "#E7B98A" }: { x: number; hair: string; top: string; bottom: string; skin?: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <ellipse cx={0} cy={172} rx={13} ry={4} fill="#DCE8DF" opacity={0.6} />
      <path d="M-9 172 L-6 128 Q-6 118 0 118 Q6 118 6 128 L9 172 Z" fill={bottom} />
      <path d="M-8 128 Q-9 96 0 92 Q9 96 8 128 Q0 136 -8 128 Z" fill={top} />
      <circle cx={0} cy={78} r={11} fill={skin} />
      <path d="M-11 76 A11 11 0 0 1 11 76 Q11 65 0 63 Q-11 65 -11 76 Z" fill={hair} />
    </g>
  );
}

export function SettlingIllustration() {
  return (
    <svg viewBox="0 0 480 300" width="100%" height="100%" role="img" aria-label="Family walking into their new community">
      <circle cx={70} cy={40} r={16} fill="#fff" opacity={0.5} />
      <circle cx={92} cy={46} r={12} fill="#fff" opacity={0.5} />
      <circle cx={410} cy={34} r={14} fill="#fff" opacity={0.5} />
      <circle cx={430} cy={42} r={10} fill="#fff" opacity={0.5} />

      <g opacity={0.35} fill={GREEN_LIGHT}>
        <rect x={330} y={70} width={26} height={90} />
        <rect x={360} y={40} width={30} height={120} />
        <rect x={394} y={90} width={22} height={70} />
        <rect x={420} y={60} width={28} height={100} />
      </g>

      <path d="M0 205 Q140 175 210 200 Q290 228 480 195 L480 300 L0 300 Z" fill="#EEF3EC" />

      <Tree x={70} y={150} scale={1.15} />

      <g transform="translate(300 130)">
        <rect x={0} y={40} width={90} height={70} fill={CREAM} stroke={TAN} strokeWidth={1.5} />
        <path d="M-8 40 L45 4 L98 40 Z" fill={GREEN_DARK} />
        <rect x={12} y={62} width={20} height={20} fill="#EAF3F7" stroke={TAN} strokeWidth={1.5} />
        <rect x={40} y={70} width={18} height={40} fill={GREEN_DARK} />
        <rect x={64} y={62} width={18} height={20} fill="#EAF3F7" stroke={TAN} strokeWidth={1.5} />
      </g>

      <g transform="translate(388 150)">
        <rect x={0} y={26} width={64} height={54} fill="#fff" stroke={TAN} strokeWidth={1.5} />
        <path d="M-6 26 L32 0 L70 26 Z" fill={GREEN} />
        <rect x={10} y={44} width={14} height={16} fill="#EAF3F7" stroke={TAN} strokeWidth={1.2} />
        <rect x={40} y={44} width={14} height={16} fill="#EAF3F7" stroke={TAN} strokeWidth={1.2} />
      </g>

      <path d="M120 210 C 170 190, 200 190, 230 178 C 270 162, 300 168, 330 178" fill="none" stroke={TAN} strokeWidth={22} strokeLinecap="round" opacity={0.7} />

      <WalkingFigure x={130} hair="#3B2A1E" top={GREEN_DARK} bottom="#2B2F2A" />
      <WalkingFigure x={162} hair="#4A3222" top={GREEN} bottom="#37403A" skin="#E9C09A" />
      <WalkingFigure x={193} hair="#241C16" top={CREAM} bottom={GREEN_DARK} skin="#D9A876" />

      <g transform="translate(112 150)">
        <rect x={0} y={0} width={20} height={26} rx={3} fill={GREEN} stroke={GREEN_DARK} strokeWidth={1.5} />
        <path d="M4 0 V-8 M16 0 V-8" stroke={GREEN_DARK} strokeWidth={2} />
        <circle cx={4} cy={28} r={2.5} fill={GREEN_DARK} />
        <circle cx={16} cy={28} r={2.5} fill={GREEN_DARK} />
      </g>
    </svg>
  );
}

export function SportsIllustration() {
  return (
    <svg viewBox="0 0 300 180" width="100%" height="100%" role="img" aria-label="Sports clubs illustration">
      <defs>
        <linearGradient id="sports-scoreboard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN_DARK} />
          <stop offset="100%" stopColor="#0F4A2E" />
        </linearGradient>
        <linearGradient id="sports-football" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={colors.orange} />
          <stop offset="50%" stopColor={GREEN} />
          <stop offset="100%" stopColor={colors.orange} />
        </linearGradient>
      </defs>

      <ellipse cx={150} cy={168} rx={130} ry={8} fill="#DCE8DF" opacity={0.5} />

      {/* clipboard w/ tactics diagram */}
      <g transform="translate(96 20)">
        <rect x={0} y={0} width={72} height={92} rx={8} fill={GREEN_LIGHT} fillOpacity={0.35} stroke={GREEN} strokeWidth={2.5} />
        <rect x={22} y={-8} width={28} height={14} rx={5} fill={GREEN_DARK} />
        <circle cx={36} cy={46} r={5} fill="none" stroke={GREEN} strokeWidth={2} />
        <path d="M36 46 L14 20" stroke={colors.orange} strokeWidth={2} strokeDasharray="4 3" fill="none" />
        <path d="M36 46 L58 26" stroke={colors.orange} strokeWidth={2} strokeDasharray="4 3" fill="none" />
        <path d="M36 46 L36 78" stroke={colors.orange} strokeWidth={2} strokeDasharray="4 3" fill="none" />
        <circle cx={14} cy={20} r={4} fill={GREEN} />
        <circle cx={58} cy={26} r={4} fill={GREEN} />
        <path d="M28 74 l8 8 l8 -8" stroke={GREEN_DARK} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* scoreboard */}
      <g transform="translate(184 30)">
        <rect x={0} y={0} width={92} height={58} rx={9} fill="url(#sports-scoreboard)" />
        {["#5CB85C", colors.gold, colors.orange].map((c, i) => (
          <g key={i}>
            <circle cx={9 + i * 8} cy={9} r={2.6} fill={c} />
            <circle cx={59 + i * 8} cy={9} r={2.6} fill={c} />
          </g>
        ))}
        <text x={13} y={26} fill="#fff" fontSize={9} fontWeight={700} fontFamily="sans-serif">HOME</text>
        <text x={62} y={26} fill="#fff" fontSize={9} fontWeight={700} fontFamily="sans-serif">AWAY</text>
        <text x={20} y={50} fill={colors.gold} fontSize={22} fontWeight={800} fontFamily="sans-serif">2</text>
        <text x={44} y={50} fill="#fff" fontSize={16} fontWeight={700} fontFamily="sans-serif">:</text>
        <text x={62} y={50} fill={colors.gold} fontSize={22} fontWeight={800} fontFamily="sans-serif">1</text>
        <rect x={40} y={62} width={12} height={22} fill={GREEN_DARK} />
      </g>

      {/* soccer ball */}
      <g transform="translate(52 116)">
        <circle r={26} fill="#fff" stroke={colors.dark} strokeWidth={2} />
        <path d="M0 -13 L11 -4 L7 10 L-7 10 L-11 -4 Z" fill={colors.dark} />
        <path d="M0 -13 L0 -26 M11 -4 L23 -8 M7 10 L14 22 M-7 10 L-14 22 M-11 -4 L-23 -8" stroke={colors.dark} strokeWidth={1.5} />
      </g>

      {/* basketball */}
      <g transform="translate(112 130)">
        <circle r={22} fill={colors.orange} stroke={colors.orangeDark} strokeWidth={2} />
        <path d="M-22 0 H22 M0 -22 V22" stroke={colors.orangeDark} strokeWidth={1.6} />
        <path d="M-16 -16 C -8 -8, -8 8, -16 16" stroke={colors.orangeDark} strokeWidth={1.6} fill="none" />
        <path d="M16 -16 C 8 -8, 8 8, 16 16" stroke={colors.orangeDark} strokeWidth={1.6} fill="none" />
      </g>

      {/* football (green/orange) */}
      <g transform="translate(170 122) rotate(-20)">
        <ellipse rx={27} ry={14} fill="url(#sports-football)" stroke={colors.orangeDark} strokeWidth={1.5} />
        <line x1={-16} y1={0} x2={16} y2={0} stroke="#fff" strokeWidth={2} />
        {[-9, -3, 3, 9].map((x) => (
          <line key={x} x1={x} y1={-2.6} x2={x} y2={2.6} stroke="#fff" strokeWidth={1.6} />
        ))}
      </g>
    </svg>
  );
}
