"use client";
// Logo lab: wordmark styles for the two-line "Basketball Legends" title, logo marks (and how they read at
// favicon size), and lockups that put the two together. Pick by number.
import { useState } from "react";

const NAVY = "#0d1b2e";
const AMBER = "#ffb627";
const ORANGE = "#e0692c";
const NET = "#f2f5f8";
const WOOD = "#d59a5b";
const WOOD_DEEP = "#a86e37";

const title = "font-display font-black leading-[0.85] tracking-tight";

/** The basketball from the favicon, as a reusable mark. */
function Ball({ size = 64, ring = AMBER, seams = "#1a0f0a", fill = ORANGE }: { size?: number | string; ring?: string; seams?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 300 300" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <circle cx="150" cy="150" r="140" fill={fill} />
      <g fill="none" stroke={seams} strokeWidth="12" strokeLinecap="round">
        <path d="M10 150 H290" />
        <path d="M150 10 V290" />
        <path d="M50 52 C102 104 102 196 50 248" />
        <path d="M250 52 C198 104 198 196 250 248" />
      </g>
      <circle cx="150" cy="150" r="140" fill="none" stroke={ring} strokeWidth="9" />
    </svg>
  );
}

interface Option {
  id: string;
  name: string;
  note: string;
  render: (size: "lg" | "sm") => React.ReactNode;
}

const sizeCls = (s: "lg" | "sm") => (s === "lg" ? "text-[clamp(3rem,7vw,6.5rem)]" : "text-4xl");

const WORDMARKS: Option[] = [
  {
    id: "W1",
    name: "Amber Legends",
    note: "The smallest change: Basketball stays white, Legends picks up the game's amber.",
    render: (s) => (
      <h2 className={`${title} ${sizeCls(s)}`}>
        <span className="text-net">Basketball</span>
        <br />
        <span style={{ color: AMBER }}>Legends</span>
      </h2>
    ),
  },
  {
    id: "W2",
    name: "Hardwood",
    note: "Both lines filled with a honey hardwood grain, like the arena floors.",
    render: (s) => (
      <h2
        className={`${title} ${sizeCls(s)}`}
        style={{
          backgroundImage: `repeating-linear-gradient(90deg, ${WOOD} 0 14px, #c88a4c 14px 16px, ${WOOD} 16px 34px, ${WOOD_DEEP} 34px 35px), linear-gradient(180deg, #f0c085, ${WOOD_DEEP})`,
          backgroundBlendMode: "multiply",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          filter: "drop-shadow(0 3px 0 rgba(0,0,0,0.35))",
        }}
      >
        Basketball
        <br />
        Legends
      </h2>
    ),
  },
  {
    id: "W3",
    name: "Varsity outline",
    note: "Amber letters with a navy gap and a white outer stroke, like stitched tackle twill.",
    render: (s) => (
      <h2
        className={`${title} ${sizeCls(s)}`}
        style={{
          color: AMBER,
          WebkitTextStroke: s === "lg" ? `3px ${NAVY}` : `1.5px ${NAVY}`,
          paintOrder: "stroke fill",
          textShadow: `0 0 0 ${NET}, 3px 3px 0 ${NET}, -1px -1px 0 ${NET}, 1px -1px 0 ${NET}, -1px 1px 0 ${NET}`,
        }}
      >
        Basketball
        <br />
        Legends
      </h2>
    ),
  },
  {
    id: "W4",
    name: "3D block",
    note: "White letters extruded down and to the right in amber and burnt orange: big and loud.",
    render: (s) => {
      const d = s === "lg" ? 7 : 3;
      const shadow = Array.from({ length: d }, (_, i) => `${i + 1}px ${i + 1}px 0 ${i < d / 2 ? AMBER : ORANGE}`).join(", ");
      return (
        <h2 className={`${title} ${sizeCls(s)} text-net`} style={{ textShadow: `${shadow}, ${d + 2}px ${d + 4}px 12px rgba(0,0,0,0.45)` }}>
          Basketball
          <br />
          Legends
        </h2>
      );
    },
  },
  {
    id: "W5",
    name: "Neon",
    note: "Glowing tube letters, Basketball in white and Legends in amber, like a sign over the rooftop court.",
    render: (s) => (
      <h2 className={`${title} ${sizeCls(s)}`}>
        <span className="text-net" style={{ textShadow: `0 0 6px #fff, 0 0 18px #9ad7ff, 0 0 36px #4cc3ff` }}>
          Basketball
        </span>
        <br />
        <span style={{ color: "#fff3d6", textShadow: `0 0 6px ${AMBER}, 0 0 20px ${AMBER}, 0 0 44px ${ORANGE}` }}>Legends</span>
      </h2>
    ),
  },
  {
    id: "W6",
    name: "Sunset stripes",
    note: "Legends filled with retro stripes, amber to orange to red; Basketball in clean white above it.",
    render: (s) => (
      <h2 className={`${title} ${sizeCls(s)}`}>
        <span className="text-net">Basketball</span>
        <br />
        <span
          style={{
            backgroundImage: `linear-gradient(180deg, #ffd166 0 22%, ${AMBER} 22% 44%, ${ORANGE} 44% 66%, #c8102e 66% 88%, #7b1e3a 88%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Legends
        </span>
      </h2>
    ),
  },
  {
    id: "W7",
    name: "Fast break",
    note: "Slanted forward with speed streaks trailing off the left, for a sports-broadcast feel.",
    render: (s) => (
      <div className="relative inline-block" style={{ transform: "skewX(-9deg)" }}>
        <div className="absolute -left-10 top-1/2 flex -translate-y-1/2 flex-col gap-2" aria-hidden>
          {[44, 30, 52, 24].map((w, i) => (
            <span key={i} className="block h-1.5 rounded-full" style={{ width: s === "lg" ? w : w / 2, background: i % 2 ? ORANGE : AMBER }} />
          ))}
        </div>
        <h2 className={`${title} ${sizeCls(s)} italic`}>
          <span className="text-net">Basketball</span>
          <br />
          <span style={{ color: AMBER }}>Legends</span>
        </h2>
      </div>
    ),
  },
  {
    id: "W8",
    name: "Hall of Fame gold",
    note: "Metallic gold with a soft bevel, like a trophy plate.",
    render: (s) => (
      <h2
        className={`${title} ${sizeCls(s)}`}
        style={{
          backgroundImage: "linear-gradient(180deg, #fff4c2 0%, #f7d774 28%, #c99a2e 52%, #f2cf6b 70%, #8a6416 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          filter: "drop-shadow(0 2px 0 #5a3d0a) drop-shadow(0 6px 10px rgba(0,0,0,0.5))",
        }}
      >
        Basketball
        <br />
        Legends
      </h2>
    ),
  },
  {
    id: "W9",
    name: "Court lines",
    note: "White letters over a faint amber three-point arc and free-throw lane, drawn like court paint.",
    render: (s) => (
      <div className="relative inline-block">
        <svg className="absolute -inset-x-6 -inset-y-4 h-[calc(100%+2rem)] w-[calc(100%+3rem)]" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden>
          <path d="M10 210 A190 190 0 0 1 390 210" fill="none" stroke={AMBER} strokeOpacity="0.45" strokeWidth="3" />
          <rect x="140" y="80" width="120" height="130" fill="none" stroke={AMBER} strokeOpacity="0.35" strokeWidth="3" />
          <circle cx="200" cy="80" r="60" fill="none" stroke={AMBER} strokeOpacity="0.3" strokeWidth="3" strokeDasharray="10 8" />
        </svg>
        <h2 className={`${title} ${sizeCls(s)} relative text-net`}>
          Basketball
          <br />
          Legends
        </h2>
      </div>
    ),
  },
  {
    id: "W10",
    name: "Big Legends",
    note: "A new hierarchy: BASKETBALL small and widely spaced, LEGENDS huge in amber underneath.",
    render: (s) => (
      <h2 className="font-display font-black uppercase leading-none">
        <span className={`block text-net ${s === "lg" ? "text-[clamp(1.4rem,3vw,2.6rem)] tracking-[0.42em]" : "text-base tracking-[0.35em]"}`}>Basketball</span>
        <span className={`block ${s === "lg" ? "text-[clamp(3.6rem,9vw,8rem)]" : "text-5xl"} leading-[0.85] tracking-tight`} style={{ color: AMBER }}>
          Legends
        </span>
      </h2>
    ),
  },
];

const LOCKUPS: Option[] = [
  {
    id: "L1",
    name: "Ball beside the title",
    note: "The favicon's ball standing beside the two lines, as tall as both: the ball becomes the logo.",
    render: (s) => (
      <div className="flex items-center gap-4">
        <Ball size={s === "lg" ? 150 : 64} />
        <h2 className={`${title} ${sizeCls(s)}`}>
          <span className="text-net">Basketball</span>
          <br />
          <span style={{ color: AMBER }}>Legends</span>
        </h2>
      </div>
    ),
  },
  {
    id: "L2",
    name: "Ball as the first A",
    note: "The ball replaces the a in Basketball. Reads as one word at a glance, with a little surprise.",
    render: (s) => {
      const b = s === "lg" ? "0.78em" : "0.78em";
      return (
        <h2 className={`${title} ${sizeCls(s)}`}>
          <span className="text-net">
            B
            <span className="inline-block align-baseline" style={{ width: b, height: b, margin: "0 0.02em" }}>
              <Ball size="100%" />
            </span>
            sketball
          </span>
          <br />
          <span style={{ color: AMBER }}>Legends</span>
        </h2>
      );
    },
  },
  {
    id: "L3",
    name: "Shot arc",
    note: "An amber arc launches off Basketball and drops the ball in above the end of Legends.",
    render: (s) => (
      <div className="relative inline-block pr-16">
        <svg className="absolute right-0 top-[-10%] h-[70%] w-[55%]" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden>
          <path d="M0 110 Q 110 -40 170 70" fill="none" stroke={AMBER} strokeWidth="5" strokeDasharray="2 10" strokeLinecap="round" />
        </svg>
        <span className="absolute right-0 top-[38%]">
          <Ball size={s === "lg" ? 54 : 26} />
        </span>
        <h2 className={`${title} ${sizeCls(s)}`}>
          <span className="text-net">Basketball</span>
          <br />
          <span style={{ color: AMBER }}>Legends</span>
        </h2>
      </div>
    ),
  },
  {
    id: "L4",
    name: "Crowned",
    note: "A small amber crown resting on the L of Legends (legends are royalty), no ball needed.",
    render: (s) => (
      <h2 className={`${title} ${sizeCls(s)}`}>
        <span className="text-net">Basketball</span>
        <br />
        <span className="relative inline-block" style={{ color: AMBER }}>
          <svg className="absolute left-[-0.2em] top-[-0.08em] h-[0.34em] w-[0.48em]" style={{ transform: "rotate(-24deg)" }} viewBox="0 0 60 40" aria-hidden>
            <path d="M4 36 L8 10 L20 24 L30 4 L40 24 L52 10 L56 36 Z" fill={AMBER} stroke={NAVY} strokeWidth="2" />
          </svg>
          Legends
        </span>
      </h2>
    ),
  },
];

/** Logo marks: square icons that work as the favicon, the app icon and anywhere the title is too long. */
const MARKS: { id: string; name: string; note: string; svg: React.ReactNode }[] = [
  {
    id: "M1",
    name: "The ball (today's favicon)",
    note: "What we use now: the ball on navy under an arc. Simple and readable at any size.",
    svg: (
      <svg viewBox="0 0 512 512" className="h-full w-full">
        <rect width="512" height="512" rx="112" fill={NAVY} />
        <path d="M96 404 A220 220 0 0 1 416 404" fill="none" stroke="#2c4566" strokeWidth="14" />
        <g transform="translate(108 88) scale(0.987)">
          <Ball size={300} />
        </g>
      </svg>
    ),
  },
  {
    id: "M2",
    name: "BL monogram",
    note: "Tall B and L in Big Shoulders; the ball forms the B's lower bowl. Works as a sticker or a court logo.",
    svg: (
      <svg viewBox="0 0 512 512" className="h-full w-full">
        <rect width="512" height="512" rx="112" fill={NAVY} />
        <text x="88" y="400" fontFamily="var(--font-display)" fontWeight="900" fontSize="360" fill={NET}>
          B
        </text>
        <text x="282" y="400" fontFamily="var(--font-display)" fontWeight="900" fontSize="360" fill={AMBER}>
          L
        </text>
        <g transform="translate(150 250) scale(0.42)">
          <Ball size={300} ring={NAVY} />
        </g>
      </svg>
    ),
  },
  {
    id: "M3",
    name: "Crowned ball",
    note: "The ball wearing an amber crown: says Legends without words.",
    svg: (
      <svg viewBox="0 0 512 512" className="h-full w-full">
        <rect width="512" height="512" rx="112" fill={NAVY} />
        <g transform="translate(126 150) scale(0.867)">
          <Ball size={300} />
        </g>
        <path d="M146 150 L162 70 L210 118 L256 44 L302 118 L350 70 L366 150 Z" fill={AMBER} stroke={NAVY} strokeWidth="8" strokeLinejoin="round" />
        <circle cx="256" cy="44" r="14" fill={AMBER} />
      </svg>
    ),
  },
  {
    id: "M4",
    name: "Crest",
    note: "A shield with the ball and BL, like a club badge. Great big; busier small.",
    svg: (
      <svg viewBox="0 0 512 512" className="h-full w-full">
        <rect width="512" height="512" rx="112" fill={NAVY} />
        <path d="M256 40 L440 96 V250 C440 360 360 430 256 474 C152 430 72 360 72 250 V96 Z" fill="#16283f" stroke={AMBER} strokeWidth="14" />
        <g transform="translate(166 110) scale(0.6)">
          <Ball size={300} />
        </g>
        <text x="256" y="420" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="900" fontSize="110" fill={NET} letterSpacing="8">
          BL
        </text>
      </svg>
    ),
  },
  {
    id: "M5",
    name: "Swish",
    note: "A rim and net with the ball dropping through: the moment the game is about.",
    svg: (
      <svg viewBox="0 0 512 512" className="h-full w-full">
        <rect width="512" height="512" rx="112" fill={NAVY} />
        <g transform="translate(176 40) scale(0.533)">
          <Ball size={300} />
        </g>
        <ellipse cx="256" cy="262" rx="150" ry="30" fill="none" stroke={ORANGE} strokeWidth="16" />
        <g stroke={NET} strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.9">
          {[-120, -70, -20, 30, 80, 130].map((x, i) => (
            <path key={i} d={`M${256 + x} ${268 + Math.abs(x) * -0.08} L${256 + x * 0.55} 440`} />
          ))}
          <path d="M150 330 Q256 360 362 330" />
          <path d="M175 390 Q256 412 337 390" />
        </g>
      </svg>
    ),
  },
  {
    id: "M6",
    name: "Badge ring",
    note: "BASKETBALL LEGENDS running around a ring with the ball in the middle, like a medal or a patch.",
    svg: (
      <svg viewBox="0 0 512 512" className="h-full w-full">
        <rect width="512" height="512" rx="112" fill={NAVY} />
        <circle cx="256" cy="256" r="210" fill="#16283f" stroke={AMBER} strokeWidth="12" />
        <circle cx="256" cy="256" r="118" fill="none" stroke="#2c4566" strokeWidth="6" />
        <defs>
          <path id="ringTop" d="M104 256 A152 152 0 0 1 408 256" />
          <path id="ringBottom" d="M104 256 A152 152 0 0 0 408 256" />
        </defs>
        <text fontFamily="var(--font-display)" fontWeight="900" fontSize="46" fill={NET} letterSpacing="9">
          <textPath href="#ringTop" startOffset="50%" textAnchor="middle">
            BASKETBALL
          </textPath>
        </text>
        <text fontFamily="var(--font-display)" fontWeight="900" fontSize="46" fill={AMBER} letterSpacing="12">
          <textPath href="#ringBottom" startOffset="50%" textAnchor="middle" dominantBaseline="hanging">
            LEGENDS
          </textPath>
        </text>
        <g transform="translate(161 161) scale(0.633)">
          <Ball size={300} />
        </g>
      </svg>
    ),
  },
];

function Backdrop({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // the main menu's look: navy fading over the arena
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--radius-panel)] ring-1 ring-line ${className}`}
      style={{ background: `radial-gradient(120% 120% at 100% 0%, #2a3f5c 0%, ${NAVY} 55%)` }}
    >
      <div className="absolute inset-0 opacity-20" style={{ background: "repeating-linear-gradient(90deg, #d59a5b 0 22px, #c88a4c 22px 24px)" }} aria-hidden />
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(90deg, ${NAVY} 0%, rgba(13,27,46,0.8) 55%, rgba(13,27,46,0.35) 100%)` }}
        aria-hidden
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export function LogoLab() {
  const [menu, setMenu] = useState("W1");
  const all = [...WORDMARKS, ...LOCKUPS];
  const chosen = all.find((o) => o.id === menu) ?? all[0];
  return (
    <div className="min-h-dvh bg-navy px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="font-display text-5xl font-black">Logo lab</h1>
        <p className="mt-2 max-w-3xl text-steel">
          Options for the title on the main menu, all keeping the two lines, plus logo marks for the favicon and app icon, and lockups that combine the two.
          Tell me the numbers you like (for example &ldquo;W6 with M3&rdquo;) and I&apos;ll put them in the game. Click any title to preview it on the menu
          below.
        </p>

        <section className="mt-8">
          <h2 className="mb-3 font-display text-3xl font-black">Title styles</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {WORDMARKS.map((o) => (
              <button
                key={o.id}
                onClick={() => setMenu(o.id)}
                className={`text-left ${menu === o.id ? "outline outline-2 outline-amber" : ""} rounded-[var(--radius-panel)]`}
              >
                <Backdrop className="p-6">
                  <p className="mb-3 text-sm font-semibold text-amber">
                    {o.id} · {o.name}
                  </p>
                  <div className="min-h-[12rem]">{o.render("lg")}</div>
                  <p className="mt-4 text-sm text-steel">{o.note}</p>
                </Backdrop>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-1 font-display text-3xl font-black">Logo marks</h2>
          <p className="mb-3 text-sm text-steel">Each at app-icon size and at the sizes a browser tab and a bookmark use.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MARKS.map((m) => (
              <div key={m.id} className="rounded-[var(--radius-panel)] bg-deck p-5 ring-1 ring-line">
                <p className="mb-3 text-sm font-semibold text-amber">
                  {m.id} · {m.name}
                </p>
                <div className="flex items-end gap-4">
                  <div className="h-36 w-36">{m.svg}</div>
                  <div className="h-12 w-12">{m.svg}</div>
                  <div className="h-8 w-8">{m.svg}</div>
                  <div className="h-4 w-4">{m.svg}</div>
                </div>
                {/* how it reads in a browser tab */}
                <div className="mt-3 flex w-56 items-center gap-2 rounded-t-lg bg-[#2b2f36] px-3 py-1.5 text-xs text-[#e8eaed]">
                  <span className="h-4 w-4 flex-none">{m.svg}</span>
                  <span className="truncate">Basketball Legends</span>
                </div>
                <p className="mt-3 text-sm text-steel">{m.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-1 font-display text-3xl font-black">Lockups: the title with a mark worked in</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {LOCKUPS.map((o) => (
              <button
                key={o.id}
                onClick={() => setMenu(o.id)}
                className={`text-left ${menu === o.id ? "outline outline-2 outline-amber" : ""} rounded-[var(--radius-panel)]`}
              >
                <Backdrop className="p-6">
                  <p className="mb-3 text-sm font-semibold text-amber">
                    {o.id} · {o.name}
                  </p>
                  <div className="min-h-[12rem]">{o.render("lg")}</div>
                  <p className="mt-4 text-sm text-steel">{o.note}</p>
                </Backdrop>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 font-display text-3xl font-black">On the main menu: {chosen.id}</h2>
          <Backdrop className="px-8 py-10">
            {chosen.render("lg")}
            <ul className="mt-6 flex flex-col">
              {["Play now", "Quick Play", "Play in the Park", "Career", "Settings"].map((l, i) => (
                <li
                  key={l}
                  className={`py-1 font-display text-[clamp(1.6rem,4vw,2.6rem)] font-extrabold leading-tight ${i === 0 ? "text-amber" : "text-net/80"}`}
                >
                  {l}
                </li>
              ))}
            </ul>
          </Backdrop>
          <p className="mt-2 text-sm text-steel">And small, as in a page header:</p>
          <div className="mt-2 inline-block rounded-[var(--radius-chip)] bg-deck p-4 ring-1 ring-line">{chosen.render("sm")}</div>
        </section>
      </div>
    </div>
  );
}
