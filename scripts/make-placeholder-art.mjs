// 땜빵 그림 생성기: "원에 눈 단" 스탠딩 스프라이트와 첫 만남 CG를 SVG로 만든다.
// 진짜 스탠딩 일러가 생기면 web/sprites/<팩 이름>/에 manifest.json과 그림을 넣고 설정에서 고르면 된다.
//
//   npm run sprites

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPRITES = join(ROOT, "web", "sprites", "placeholder");
const CG = join(ROOT, "web", "cg");

const INK = "#1d2230";
const BLUSH = "#f39a9a";
const W = 400;
const H = 520;
const CX = 200;
const CY = 330;
const R = 150;
const EYES = [[150, 312], [250, 312]];

// ── 부품 ──

const defs = `
  <defs>
    <radialGradient id="body" cx="38%" cy="30%" r="80%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#f3efe7"/>
      <stop offset="1" stop-color="#d6cebf"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#bfe3ff" stop-opacity=".75"/>
      <stop offset="1" stop-color="#bfe3ff" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

const blink = (dur = 4.6) => `<animateTransform attributeName="transform" type="scale" additive="sum" values="1 1;1 1;1 .08;1 1" keyTimes="0;.93;.965;1" dur="${dur}s" repeatCount="indefinite"/>`;

/** 뜬 눈: 흰자 + 눈동자 + 하이라이트. 눈꺼풀(lid)은 위에서 덮는 비율 0..1, flat이면 일자 눈꺼풀. */
function openEye([x, y], { px = 0, py = 4, rx = 30, ry = 38, pupil = 15, lid = 0, flat = false, blinkDur = 4.6, drift = false } = {}) {
  const lidH = ry * 2 * lid;
  const lidPath = lid > 0
    ? flat
      ? `<rect x="${-rx - 3}" y="${-ry - 3}" width="${rx * 2 + 6}" height="${lidH + 3}" fill="url(#body)"/><line x1="${-rx}" y1="${-ry + lidH}" x2="${rx}" y2="${-ry + lidH}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
      : `<path d="M ${-rx - 3} ${-ry - 3} H ${rx + 3} V ${-ry + lidH} Q 0 ${-ry + lidH + 10} ${-rx - 3} ${-ry + lidH} Z" fill="url(#body)"/><path d="M ${-rx} ${-ry + lidH + 2} Q 0 ${-ry + lidH + 11} ${rx} ${-ry + lidH + 2}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`
    : "";
  const pupilAnim = drift ? `<animateTransform attributeName="transform" type="translate" values="0 0;5 1;-4 2;0 0" dur="9s" repeatCount="indefinite"/>` : "";
  return `
    <g transform="translate(${x} ${y})"><g>
      <clipPath id="eye${x}${y}${rx}${ry}"><ellipse rx="${rx}" ry="${ry}"/></clipPath>
      <g clip-path="url(#eye${x}${y}${rx}${ry})">
        <ellipse rx="${rx}" ry="${ry}" fill="#fff"/>
        <g transform="translate(${px} ${py})">${pupilAnim}
          <circle r="${pupil}" fill="${INK}"/>
          <circle cx="${pupil * 0.35}" cy="${-pupil * 0.4}" r="${Math.max(2.5, pupil * 0.32)}" fill="#fff"/>
        </g>
        ${lidPath}
      </g>
      <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-opacity=".18" stroke-width="2"/>
      ${blinkDur ? blink(blinkDur) : ""}
    </g></g>`;
}

const arcEye = ([x, y], up = true) => `<path d="M ${x - 26} ${y + (up ? 8 : -6)} Q ${x} ${y + (up ? -22 : 22)} ${x + 26} ${y + (up ? 8 : -6)}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
const blush = (opacity = 0.55) => `<ellipse cx="124" cy="370" rx="26" ry="12" fill="${BLUSH}" opacity="${opacity}"/><ellipse cx="276" cy="370" rx="26" ry="12" fill="${BLUSH}" opacity="${opacity}"/>`;
const mouth = {
  talk: `<ellipse cx="${CX}" cy="390" rx="13" ry="6" fill="#3a2d33"><animate attributeName="ry" values="3;9;4;8;3" dur=".55s" repeatCount="indefinite"/></ellipse>`,
  smile: `<path d="M 182 382 Q 200 398 218 382" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  frown: `<path d="M 184 394 Q 200 382 216 394" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  o: `<ellipse cx="${CX}" cy="392" rx="9" ry="11" fill="#3a2d33"/>`,
  flat: `<line x1="186" y1="390" x2="214" y2="390" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  wobble: `<path d="M 180 390 q 5 -5 10 0 t 10 0 t 10 0 t 10 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
};
const sweat = `<path d="M 330 214 q 14 22 0 30 q -14 -8 0 -30 z" fill="#a8d8ff" stroke="${INK}" stroke-opacity=".25" stroke-width="2"/>`;
const tear = `<path d="M 268 352 q 9 16 0 22 q -9 -6 0 -22 z" fill="#a8d8ff"><animateTransform attributeName="transform" type="translate" values="0 0;0 22;0 0" keyTimes="0;.9;1" dur="2.4s" repeatCount="indefinite"/></path>`;
const exclaim = `<g transform="translate(332 176)"><rect x="-7" y="-46" width="14" height="40" rx="7" fill="${INK}"/><circle cy="10" r="8" fill="${INK}"/></g>`;
const anger = `<g transform="translate(316 218)" stroke="#e0564f" stroke-width="7" stroke-linecap="round" fill="none"><path d="M -18 -6 q 6 0 6 -12"/><path d="M 6 -18 q 0 6 12 6"/><path d="M 18 6 q -6 0 -6 12"/><path d="M -6 18 q 0 -6 -12 -6"/></g>`;
const thoughtDots = `<g fill="#fff" stroke="${INK}" stroke-opacity=".25" stroke-width="2">
  <circle cx="300" cy="196" r="8"><animate attributeName="opacity" values=".2;1;.2" dur="1.5s" repeatCount="indefinite"/></circle>
  <circle cx="326" cy="164" r="12"><animate attributeName="opacity" values=".2;1;.2" dur="1.5s" begin=".25s" repeatCount="indefinite"/></circle>
  <circle cx="358" cy="126" r="17"><animate attributeName="opacity" values=".2;1;.2" dur="1.5s" begin=".5s" repeatCount="indefinite"/></circle></g>`;
const zzz = (size = 1) => `<g font-family="Georgia, serif" font-weight="700" fill="${INK}" opacity=".7">
  ${[0, 1, 2].map((i) => `<text x="${306 + i * 22}" y="${210 - i * 30}" font-size="${(22 + i * 8) * size}">Z<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${i * 0.6}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 6;0 -6" dur="2.4s" begin="${i * 0.6}s" repeatCount="indefinite"/></text>`).join("")}</g>`;
const phone = `<ellipse cx="${CX}" cy="400" rx="90" ry="60" fill="url(#glow)"/>
  <g transform="translate(${CX} 432) rotate(-6)"><rect x="-34" y="-50" width="68" height="100" rx="12" fill="#232838"/><rect x="-28" y="-42" width="56" height="80" rx="6" fill="#cfe9ff"><animate attributeName="fill" values="#cfe9ff;#e6f4ff;#cfe9ff" dur="2s" repeatCount="indefinite"/></rect>
  <rect x="-20" y="-32" width="40" height="5" rx="2" fill="#8fb6d9"/><rect x="-20" y="-20" width="30" height="5" rx="2" fill="#8fb6d9"/><rect x="-20" y="-8" width="36" height="5" rx="2" fill="#8fb6d9"/></g>`;

function sprite({ eyes, extras = "", tilt = 0, squash = false, bob = 3.2 }) {
  const body = squash
    ? `<ellipse cx="${CX}" cy="${CY + 18}" rx="${R + 10}" ry="${R - 12}" fill="url(#body)"/><ellipse cx="${CX}" cy="${CY + 18}" rx="${R + 10}" ry="${R - 12}" fill="none" stroke="${INK}" stroke-opacity=".10" stroke-width="3"/>`
    : `<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#body)"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${INK}" stroke-opacity=".10" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs}
  <ellipse cx="${CX}" cy="${H - 28}" rx="${squash ? 132 : 118}" ry="16" fill="#000" opacity=".16"/>
  <g transform="rotate(${tilt} ${CX} ${H - 30})"><g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="${bob}s" repeatCount="indefinite"/>
    ${body}
    ${eyes}
    ${extras}
  </g></g>
</svg>
`;
}

const both = (options) => EYES.map((at) => openEye(at, options)).join("");

const POSES = {
  neutral: sprite({ eyes: both({}) }),
  look: sprite({ eyes: both({ rx: 32, ry: 41, py: 1, pupil: 16 }) }),
  listen: sprite({ eyes: both({ px: -7, py: -2 }), tilt: -5 }),
  talk: sprite({ eyes: both({ py: 2 }), extras: mouth.talk }),
  think: sprite({ eyes: both({ px: 9, py: -11, lid: 0.28 }), extras: thoughtDots }),
  happy: sprite({ eyes: EYES.map((at) => arcEye(at, true)).join(""), extras: blush(0.6) + mouth.smile, bob: 1.6 }),
  sad: sprite({ eyes: both({ py: 9, lid: 0.3 }), extras: tear + mouth.frown, bob: 4.5 }),
  surprised: sprite({ eyes: both({ rx: 35, ry: 46, pupil: 9, py: 0, blinkDur: 0 }), extras: exclaim + mouth.o }),
  embarrassed: sprite({ eyes: both({ px: -13, py: 9 }), extras: blush(0.75) + sweat + mouth.wobble }),
  annoyed: sprite({ eyes: both({ py: 6, lid: 0.42, flat: true }), extras: anger + mouth.flat }),
  sleepy: sprite({ eyes: both({ py: 10, lid: 0.62, blinkDur: 6 }), extras: zzz(0.7), bob: 5 }),
  sleep: sprite({ eyes: EYES.map((at) => arcEye([at[0], at[1] + 10], false)).join(""), extras: zzz(1), squash: true, bob: 4 }),
  search: sprite({ eyes: both({ py: 15, lid: 0.18 }), extras: phone }),
  blank: sprite({ eyes: both({ pupil: 6, py: 0, drift: true, blinkDur: 7 }), bob: 6 }),
};

const MANIFEST = {
  name: "placeholder",
  description: "원에 눈 단 땜빵 스프라이트. 진짜 스탠딩 일러로 바꿔 끼우면 된다.",
  /** 스프라이트 원본 크기 비율 (가로/세로). UI가 자리를 잡을 때 쓴다. */
  aspect: W / H,
  /** 표정/포즈 → 파일. 없는 키는 fallback을 쓴다. */
  sprites: Object.fromEntries(Object.keys(POSES).map((key) => [key, `${key}.svg`])),
  fallback: "neutral",
  /** 이벤트 CG */
  cg: { first_meeting: "../../cg/first-meeting.svg" },
};

// ── 첫 만남 CG ──

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function rainLayer(random, count, length, opacity, dur) {
  const lines = Array.from({ length: count }, () => {
    const x = random() * 1800 - 100;
    const y = random() * 900;
    return `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - length * 0.18).toFixed(0)}" y2="${(y + length).toFixed(0)}"/>`;
  }).join("");
  return `<g stroke="#b8cdf5" stroke-opacity="${opacity}" stroke-width="2" stroke-linecap="round">
    <g>${lines}</g><g transform="translate(0 -900)">${lines}</g>
    <animateTransform attributeName="transform" type="translate" values="0 0;-160 900" dur="${dur}s" repeatCount="indefinite"/></g>`;
}

function firstMeeting() {
  const random = seeded(7);
  // 대사창이 아래 20%쯤을 덮는다. 주인공은 그 위에 오도록 바닥선을 640에 둔다.
  const ground = 640;
  const siding = Array.from({ length: 26 }, (_, i) => `<line x1="0" y1="${90 + i * 21}" x2="1600" y2="${90 + i * 21}"/>`).join("");
  const orbX = 800;
  const orbY = ground - 92;
  const eyes = [[orbX - 42, orbY - 8, -14], [orbX + 42, orbY - 8, 14]].map(([x, y, tilt]) => `
    <g transform="translate(${x} ${y})"><g>
      <ellipse rx="25" ry="29" fill="#fff"/>
      <circle cx="3" cy="-8" r="13" fill="${INK}"/><circle cx="8" cy="-13" r="4.5" fill="#fff"/><circle cx="-4" cy="-1" r="2" fill="#fff" opacity=".8"/>
      <g transform="rotate(${tilt})"><path d="M -30 -34 H 30 V -22 Q 0 -16 -30 -22 Z" fill="#cfc8ba"/><path d="M -26 -22 Q 0 -15 26 -22" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></g>
      ${blink(5.2)}
    </g></g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1222"/><stop offset="1" stop-color="#1a2944"/></linearGradient>
    <radialGradient id="lamp" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd08a" stop-opacity=".85"/><stop offset=".35" stop-color="#ffb35c" stop-opacity=".35"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
    <radialGradient id="orb" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#f7f4ee"/><stop offset=".6" stop-color="#d9d2c4"/><stop offset="1" stop-color="#9c978e"/></radialGradient>
    <radialGradient id="vignette" cx="50%" cy="45%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>
    <linearGradient id="porch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4258"/><stop offset="1" stop-color="#151a29"/></linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect y="70" width="1600" height="${ground - 70}" fill="#1f2839"/>
  <g stroke="#2a344a" stroke-width="2">${siding}</g>
  <rect x="930" y="120" width="320" height="${ground - 120}" fill="#141a28"/>
  <rect x="955" y="145" width="270" height="${ground - 145}" fill="#3b2e29"/>
  <rect x="1005" y="185" width="170" height="110" rx="6" fill="#ffcf8f" opacity=".75"/>
  <line x1="1090" y1="185" x2="1090" y2="295" stroke="#3b2e29" stroke-width="8"/>
  <circle cx="1190" cy="420" r="10" fill="#c9a46a"/>
  <rect x="1290" y="170" width="34" height="46" rx="6" fill="#ffe2b0"/>
  <ellipse cx="1307" cy="200" rx="420" ry="360" fill="url(#lamp)"/>
  <rect y="${ground}" width="1600" height="${900 - ground}" fill="url(#porch)"/>
  <rect x="880" y="${ground - 10}" width="420" height="22" rx="4" fill="#4a5168"/>
  <ellipse cx="560" cy="${ground + 90}" rx="200" ry="16" fill="#ffcf8f" opacity=".12"/>
  <ellipse cx="1160" cy="${ground + 120}" rx="260" ry="18" fill="#ffcf8f" opacity=".16"/>
  ${rainLayer(random, 90, 60, 0.28, 1.4)}
  <ellipse cx="${orbX}" cy="${orbY + 90}" rx="132" ry="16" fill="#000" opacity=".35"/>
  <g>
    <ellipse cx="${orbX}" cy="${orbY}" rx="128" ry="102" fill="url(#orb)"/>
    <ellipse cx="${orbX - 46}" cy="${orbY - 56}" rx="34" ry="15" fill="#fff" opacity=".55" transform="rotate(-24 ${orbX - 46} ${orbY - 56})"/>
    <g fill="#a8c8f0" opacity=".75">
      <path d="M ${orbX - 74} ${orbY - 18} q 6 12 0 16 q -6 -4 0 -16 z"/>
      <path d="M ${orbX + 64} ${orbY + 14} q 6 12 0 16 q -6 -4 0 -16 z"/>
      <path d="M ${orbX + 12} ${orbY - 72} q 5 10 0 13 q -5 -3 0 -13 z"/>
    </g>
    ${eyes}
  </g>
  ${rainLayer(random, 70, 90, 0.42, 0.9)}
  <rect width="1600" height="900" fill="url(#vignette)"/>
</svg>
`;
}

mkdirSync(SPRITES, { recursive: true });
mkdirSync(CG, { recursive: true });
for (const [name, svg] of Object.entries(POSES)) writeFileSync(join(SPRITES, `${name}.svg`), svg);
writeFileSync(join(SPRITES, "manifest.json"), JSON.stringify(MANIFEST, null, 2) + "\n");
writeFileSync(join(CG, "first-meeting.svg"), firstMeeting());
console.log(`sprites: ${Object.keys(POSES).length} → ${SPRITES}\ncg: first-meeting.svg → ${CG}`);
