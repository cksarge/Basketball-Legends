/**
 * Builds the game's league/team data from factual raw lists in scripts/raw.
 * Real institution & city names are kept; nicknames, colors, logos, arenas,
 * and conference names are original and deterministic (seeded by team id).
 *
 *   npx tsx scripts/build-data.ts
 */
import fs from "node:fs";
import path from "node:path";
import { Rng, hashString } from "../src/engine/rng";
import type { Conference, LogoIcon, LogoSpec, Team, TeamLevel } from "../src/engine/types";

const RAW = path.join(__dirname, "raw");
const OUT = path.join(__dirname, "..", "src", "data", "generated");
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8"));

// ---------------------------------------------------------------------------
// Identity pools
// ---------------------------------------------------------------------------

const NICKNAMES: [string, LogoIcon][] = [
  ["Aces", "star"],
  ["Admirals", "anchor"],
  ["Aviators", "wing"],
  ["Avalanche", "mountain"],
  ["Badgers", "paw"],
  ["Bandits", "star"],
  ["Barons", "crown"],
  ["Bison", "horn"],
  ["Blaze", "flame"],
  ["Bobcats", "claw"],
  ["Bolts", "bolt"],
  ["Bombers", "wing"],
  ["Brigade", "shield"],
  ["Buccaneers", "anchor"],
  ["Buffaloes", "horn"],
  ["Cardinals", "feather"],
  ["Chargers", "bolt"],
  ["Chiefs", "feather"],
  ["Comets", "star"],
  ["Condors", "wing"],
  ["Cougars", "claw"],
  ["Coyotes", "paw"],
  ["Crusaders", "shield"],
  ["Cyclones", "wave"],
  ["Defenders", "shield"],
  ["Dragons", "flame"],
  ["Dukes", "crown"],
  ["Dust Devils", "wave"],
  ["Eagles", "wing"],
  ["Embers", "flame"],
  ["Explorers", "arrow"],
  ["Express", "arrow"],
  ["Falcons", "wing"],
  ["Firebirds", "flame"],
  ["Flyers", "wing"],
  ["Foxes", "paw"],
  ["Generals", "star"],
  ["Giants", "mountain"],
  ["Gladiators", "shield"],
  ["Guardians", "shield"],
  ["Gulls", "wing"],
  ["Hammers", "gear"],
  ["Harriers", "wing"],
  ["Highlanders", "mountain"],
  ["Hounds", "paw"],
  ["Hurricanes", "wave"],
  ["Ice", "moon"],
  ["Jaguars", "claw"],
  ["Jackrabbits", "paw"],
  ["Javelinas", "horn"],
  ["Kestrels", "wing"],
  ["Knights", "shield"],
  ["Lancers", "arrow"],
  ["Lightning", "bolt"],
  ["Lions", "crown"],
  ["Lobos", "paw"],
  ["Lumberjacks", "tree"],
  ["Lynx", "claw"],
  ["Mammoths", "horn"],
  ["Marauders", "anchor"],
  ["Mariners", "anchor"],
  ["Meteors", "star"],
  ["Miners", "gear"],
  ["Monarchs", "crown"],
  ["Mustangs", "horn"],
  ["Nighthawks", "moon"],
  ["Nomads", "sun"],
  ["Oaks", "tree"],
  ["Ospreys", "wing"],
  ["Owls", "moon"],
  ["Panthers", "claw"],
  ["Patriots", "star"],
  ["Phantoms", "moon"],
  ["Pilots", "wing"],
  ["Pioneers", "arrow"],
  ["Pirates", "anchor"],
  ["Prowlers", "claw"],
  ["Pumas", "claw"],
  ["Quakes", "mountain"],
  ["Racers", "arrow"],
  ["Rams", "horn"],
  ["Rangers", "star"],
  ["Rattlers", "bolt"],
  ["Ravens", "feather"],
  ["Rebels", "star"],
  ["Redtails", "feather"],
  ["Renegades", "flame"],
  ["Riptide", "wave"],
  ["Roadrunners", "feather"],
  ["Royals", "crown"],
  ["Sabercats", "claw"],
  ["Sentinels", "shield"],
  ["Scorpions", "claw"],
  ["Sharks", "wave"],
  ["Sidewinders", "bolt"],
  ["Silverbacks", "paw"],
  ["Skyhawks", "wing"],
  ["Sound", "wave"],
  ["Spartans", "shield"],
  ["Stallions", "horn"],
  ["Stars", "star"],
  ["Storm", "bolt"],
  ["Talons", "claw"],
  ["Tempest", "wave"],
  ["Thunderbirds", "bolt"],
  ["Titans", "mountain"],
  ["Tornadoes", "wave"],
  ["Tritons", "anchor"],
  ["Vandals", "flame"],
  ["Vikings", "shield"],
  ["Vipers", "bolt"],
  ["Voyagers", "anchor"],
  ["Warhawks", "wing"],
  ["Wildcats", "claw"],
  ["Wolverines", "claw"],
  ["Wolves", "paw"],
  ["Wranglers", "horn"],
  ["Yellowjackets", "bolt"],
  ["Zephyrs", "wave"],
  ["Saguaros", "tree"],
  ["Mesas", "mountain"],
  ["Canyoneers", "mountain"],
  ["Monsoon", "wave"],
  ["Heat Wave", "sun"],
  ["Copperheads", "bolt"],
  ["Gila Monsters", "claw"],
  ["Ocelots", "claw"],
  ["Bighorns", "horn"],
  ["Peregrines", "wing"],
  ["Sandpipers", "feather"],
  ["Herons", "feather"],
  ["Golden Eagles", "wing"],
  ["Blue Jays", "feather"],
  ["Orioles", "feather"],
  ["Huskies", "paw"],
  ["Bulldogs", "paw"],
  ["Terriers", "paw"],
  ["Retrievers", "paw"],
  ["Mastiffs", "paw"],
  ["Gryphons", "wing"],
  ["Phoenixes", "flame"],
  ["Centaurs", "arrow"],
  ["Minotaurs", "horn"],
  ["Krakens", "wave"],
  ["Sasquatch", "tree"],
  ["Yetis", "mountain"],
  ["Wizards", "star"],
  ["Druids", "tree"],
  ["Sorcerers", "moon"],
  ["Archers", "arrow"],
  ["Musketeers", "star"],
  ["Minutemen", "star"],
  ["Rough Riders", "horn"],
  ["Steamers", "gear"],
  ["Ironmen", "gear"],
  ["Forge", "flame"],
  ["Steelers", "gear"],
  ["Engineers", "gear"],
  ["Mountaineers", "mountain"],
  ["Ridgebacks", "paw"],
  ["Timber", "tree"],
  ["Redwoods", "tree"],
  ["Cedars", "tree"],
  ["Sequoias", "tree"],
  ["Pines", "tree"],
  ["Aspens", "tree"],
  ["Willows", "tree"],
  ["Sycamores", "tree"],
  ["Tide", "wave"],
  ["Surf", "wave"],
  ["Breakers", "wave"],
  ["Undertow", "wave"],
  ["Squall", "wave"],
  ["Eclipse", "moon"],
  ["Solar", "sun"],
  ["Daybreak", "sun"],
  ["Sunbirds", "sun"],
  ["Mirage", "sun"],
  ["Coyote Pack", "paw"],
  ["Bobwhites", "feather"],
  ["Quail", "feather"],
  ["Cranes", "feather"],
  ["Kingfishers", "feather"],
];

const PALETTES: [string, string, string][] = [
  ["#8c1d18", "#f2b134", "#ffffff"],
  ["#0b2545", "#8da9c4", "#ffffff"],
  ["#1b4332", "#d8f3dc", "#ffffff"],
  ["#3c096c", "#ff9e00", "#ffffff"],
  ["#212529", "#e63946", "#f1faee"],
  ["#003049", "#fcbf49", "#ffffff"],
  ["#6a040f", "#e5e5e5", "#111111"],
  ["#14213d", "#fca311", "#ffffff"],
  ["#2b9348", "#f9f871", "#111111"],
  ["#023047", "#219ebc", "#ffffff"],
  ["#5a189a", "#e0aaff", "#ffffff"],
  ["#9b2226", "#0a9396", "#ffffff"],
  ["#264653", "#e9c46a", "#ffffff"],
  ["#7f5539", "#ede0d4", "#111111"],
  ["#370617", "#f48c06", "#ffffff"],
  ["#004b23", "#ffd60a", "#ffffff"],
  ["#001d3d", "#ffc300", "#ffffff"],
  ["#590d22", "#ff8fa3", "#ffffff"],
  ["#03045e", "#00b4d8", "#ffffff"],
  ["#4a4e69", "#f2e9e4", "#22223b"],
  ["#1d3557", "#e63946", "#ffffff"],
  ["#2f3e46", "#84a98c", "#ffffff"],
  ["#6b2737", "#d4a373", "#ffffff"],
  ["#0f4c5c", "#fb8b24", "#ffffff"],
  ["#333533", "#ffd100", "#ffffff"],
  ["#5f0f40", "#0f4c5c", "#ffffff"],
  ["#3d405b", "#f2cc8f", "#ffffff"],
  ["#bc4749", "#386641", "#ffffff"],
  ["#283618", "#dda15e", "#fefae0"],
  ["#432818", "#bb9457", "#ffffff"],
  ["#10002b", "#c77dff", "#ffffff"],
  ["#7400b8", "#80ffdb", "#ffffff"],
  ["#d00000", "#ffba08", "#111111"],
  ["#1a759f", "#d9ed92", "#111111"],
  ["#081c15", "#74c69d", "#ffffff"],
  ["#540b0e", "#9e2a2b", "#fff3b0"],
  ["#0d3b66", "#f95738", "#faf0ca"],
  ["#2d00f7", "#f20089", "#ffffff"],
  ["#344e41", "#a3b18a", "#ffffff"],
  ["#6d597a", "#e56b6f", "#ffffff"],
  ["#003566", "#ffffff", "#ffd60a"],
  ["#9d0208", "#ffffff", "#03071e"],
  ["#006400", "#ffffff", "#c0c0c0"],
  ["#4b3f72", "#ffc857", "#ffffff"],
  ["#1f2041", "#4b3f72", "#ffc857"],
  ["#b5179e", "#4361ee", "#ffffff"],
  ["#e85d04", "#03071e", "#ffffff"],
  ["#118ab2", "#073b4c", "#ffd166"],
];

const SHAPES: LogoSpec["shape"][] = ["circle", "shield", "diamond", "hex", "roundel", "star", "badge"];

const ARENA_SUFFIX = ["Arena", "Fieldhouse", "Center", "Coliseum", "Pavilion", "Gymnasium", "Dome", "Hall"];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/s$/, "");

function pickNickname(rng: Rng, avoid: string, used: Set<string>): [string, LogoIcon] {
  const avoidN = norm(avoid || "");
  for (let tries = 0; tries < 400; tries++) {
    const cand = rng.pick(NICKNAMES);
    const n = norm(cand[0]);
    if (avoidN && (n === avoidN || avoidN.includes(n) || n.includes(avoidN))) continue;
    if (used.has(cand[0]) && tries < 300) continue;
    used.add(cand[0]);
    return cand;
  }
  return NICKNAMES[0];
}

function makeLogo(rng: Rng, name: string, icon: LogoIcon): LogoSpec {
  const words = name
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(of|the|and|at|de|del)$/i.test(w));
  const mono = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : (words[0] ?? "X").slice(0, 2).toUpperCase();
  return { shape: rng.pick(SHAPES), icon, monogram: mono, stripe: rng.chance(0.5) };
}

const usedAbbrevs = new Map<string, Set<string>>();
function makeAbbrev(league: string, name: string): string {
  const set = usedAbbrevs.get(league) ?? new Set<string>();
  usedAbbrevs.set(league, set);
  const clean = name.replace(/[^A-Za-z ]/g, " ").trim();
  const words = clean.split(/\s+/).filter((w) => !/^(of|the|and|at|de|del)$/i.test(w));
  const cands: string[] = [];
  if (words.length >= 3)
    cands.push(
      words
        .slice(0, 3)
        .map((w) => w[0])
        .join(""),
    );
  if (words.length >= 2)
    cands.push(
      words[0].slice(0, 2) + words[1][0],
      words[0][0] + words[1].slice(0, 2),
      words
        .map((w) => w[0])
        .join("")
        .slice(0, 4),
    );
  cands.push(words[0].slice(0, 3), words[0].slice(0, 4), words[0][0] + words[0].slice(2, 4));
  for (const c of cands) {
    const u = c.toUpperCase();
    if (u.length >= 2 && !set.has(u)) {
      set.add(u);
      return u;
    }
  }
  for (let i = 2; i < 99; i++) {
    const u = (words[0].slice(0, 3) + i).toUpperCase();
    if (!set.has(u)) {
      set.add(u);
      return u;
    }
  }
  return words[0].toUpperCase();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------
// Pro
// ---------------------------------------------------------------------------

interface ProRaw {
  id: string;
  city: string;
  nickname: string;
  abbrev: string;
  conference: string;
  division: string;
  colors: [string, string, string];
}

function buildPro() {
  const raw = read<ProRaw[]>("pro-teams.json");
  const conferences: Conference[] = ["East", "West"].map((c) => ({
    id: `pro-${c.toLowerCase()}`,
    league: "pro",
    name: `${c}ern Conference`,
    short: c,
    divisions: [...new Set(raw.filter((t) => t.conference === c).map((t) => t.division))].map((d) => ({ id: `pro-${slug(d)}`, name: d })),
  }));
  const teams: Team[] = raw.map((t) => {
    const rng = new Rng(`pro:${t.id}`);
    const icon = NICKNAMES.find((n) => n[0] === t.nickname)?.[1] ?? rng.pick(NICKNAMES)[1];
    return {
      id: `pro-${t.id}`,
      league: "pro",
      name: t.city,
      nickname: t.nickname,
      abbrev: t.abbrev,
      city: t.city,
      state: "",
      colors: { primary: t.colors[0], secondary: t.colors[1], accent: t.colors[2] },
      logo: { ...makeLogo(rng, `${t.city} ${t.nickname}`, icon), monogram: t.abbrev.slice(0, 2) },
      conferenceId: `pro-${t.conference.toLowerCase()}`,
      divisionId: `pro-${slug(t.division)}`,
      prestige: Math.round(rng.range(0.3, 0.85) * 100) / 100,
      arena: { name: `${t.city} ${rng.pick(["Arena", "Center", "Fieldhouse", "Garden", "Dome"])}`, capacity: rng.int(17500, 20500) },
    };
  });
  return { conferences, teams };
}

// ---------------------------------------------------------------------------
// College
// ---------------------------------------------------------------------------

const D1_CONF: Record<string, [string, string, number]> = {
  // real short name -> [original name, short, strength 0..1]
  ACC: ["Atlantic Seaboard Conference", "ASC", 0.92],
  "Big Ten": ["Great Lakes Conference", "GLC", 0.94],
  "Big 12": ["Plains & Peaks Conference", "P&P", 0.95],
  SEC: ["Deep South Conference", "DSC", 0.95],
  "Big East": ["Eastern Metro Conference", "EMC", 0.88],
  "Pac-12": ["Pacific Coast Conference", "PCC", 0.7],
  "Mountain West": ["High Desert Conference", "HDC", 0.72],
  "West Coast": ["Western Shores Conference", "WSC", 0.7],
  "A-10": ["Mid-Atlantic Collegiate Conference", "MACC", 0.66],
  American: ["National Metro Conference", "NMC", 0.64],
  "Missouri Valley": ["Prairie Valley Conference", "PVC", 0.6],
  "Conference USA": ["Southern Frontier Conference", "SFC", 0.52],
  MAC: ["Midwest Collegiate Conference", "MCC", 0.5],
  "Sun Belt": ["Sunshine Coast Conference", "SCC", 0.5],
  CAA: ["Colonial Coast Conference", "CCC", 0.48],
  "Horizon League": ["Rust Belt Conference", "RBC", 0.46],
  "Ivy League": ["Heritage Eight Conference", "H8", 0.48],
  "Big West": ["Pacific Shore Conference", "PSC", 0.45],
  Southern: ["Appalachian Conference", "APC", 0.45],
  "Big Sky": ["Rocky Mountain Conference", "RMC", 0.42],
  "The Summit": ["Northern Plains Conference", "NPC", 0.43],
  MAAC: ["Hudson Valley Conference", "HVC", 0.4],
  "Ohio Valley": ["River Valley Conference", "RVC", 0.38],
  Southland: ["Gulf Shores Conference", "GSC", 0.38],
  ASUN: ["Southern Sun Conference", "SSC", 0.42],
  UAC: ["Frontier Athletic Conference", "FAC", 0.4],
  "Big South": ["Piedmont Conference", "PDC", 0.38],
  "America East": ["Northeastern Conference", "NEC", 0.36],
  "Patriot League": ["Liberty Bell Conference", "LBC", 0.36],
  NEC: ["New England & Atlantic Conference", "NEAC", 0.3],
  MEAC: ["Mid-Eastern Heritage Conference", "MEHC", 0.28],
  SWAC: ["Southwestern Heritage Conference", "SWHC", 0.26],
};

const STATE_REGION: Record<string, string> = {
  ME: "New England",
  NH: "New England",
  VT: "New England",
  MA: "New England",
  RI: "New England",
  CT: "New England",
  NY: "Empire",
  NJ: "Garden",
  PA: "Keystone",
  DE: "Chesapeake",
  MD: "Chesapeake",
  DC: "Chesapeake",
  VA: "Commonwealth",
  WV: "Allegheny",
  NC: "Carolina",
  SC: "Carolina",
  GA: "Georgia Pine",
  FL: "Sunshine",
  AL: "Gulf",
  MS: "Gulf",
  LA: "Bayou",
  TN: "Volunteer",
  KY: "Bluegrass",
  OH: "Buckeye",
  MI: "Great Lakes",
  IN: "Crossroads",
  IL: "Prairie",
  WI: "Northwoods",
  MN: "North Star",
  IA: "Heartland",
  MO: "Gateway",
  AR: "Ozark",
  OK: "Red River",
  TX: "Texan",
  KS: "Sunflower",
  NE: "Cornhusker",
  SD: "Dakota",
  ND: "Dakota",
  MT: "Treasure State",
  WY: "High Plains",
  CO: "Front Range",
  NM: "Enchanted",
  AZ: "Desert",
  UT: "Wasatch",
  NV: "Silver",
  ID: "Gem",
  WA: "Cascade",
  OR: "Cascade",
  CA: "Golden Coast",
  AK: "Northern",
  HI: "Island",
  PR: "Caribbean",
  BC: "Cascade",
};
const CONF_SUFFIX = [
  "Athletic Conference",
  "Collegiate Conference",
  "Intercollegiate League",
  "Athletic Alliance",
  "College League",
  "Collegiate Alliance",
  "Hoops Conference",
  "Sports Union",
];

interface CollegeRaw {
  name: string;
  full: string;
  city: string;
  state: string;
  conference: string;
  enrollment?: number;
  tourneyApps?: number;
  finalFours?: number;
  titles?: number;
  avoidNickname?: string;
}

function buildCollege() {
  const conferences: Conference[] = [];
  const teams: Team[] = [];
  const confIdByRaw = new Map<string, string>();
  const usedConfNames = new Set<string>();

  const divisions: ["D1" | "D2" | "D3", string][] = [
    ["D1", "ncaa-d1.json"],
    ["D2", "ncaa-d2.json"],
    ["D3", "ncaa-d3.json"],
  ];
  for (const [div, file] of divisions) {
    const raw = read<CollegeRaw[]>(file);
    const byConf = new Map<string, CollegeRaw[]>();
    for (const r of raw) byConf.set(r.conference, [...(byConf.get(r.conference) ?? []), r]);

    for (const [rawConf, members] of byConf) {
      let name: string, short: string;
      if (div === "D1" && D1_CONF[rawConf]) {
        [name, short] = D1_CONF[rawConf];
      } else if (rawConf === "Independent") {
        name = `${div} Independents`;
        short = "IND";
      } else {
        const counts = new Map<string, number>();
        for (const m of members) {
          const reg = STATE_REGION[m.state] ?? "National";
          counts.set(reg, (counts.get(reg) ?? 0) + 1);
        }
        const region = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const rng = new Rng(`conf:${div}:${rawConf}`);
        do {
          name = `${region} ${rng.pick(CONF_SUFFIX)}`;
        } while (
          usedConfNames.has(name) &&
          (name = `${region} ${rng.pick(["North", "South", "East", "West", "Central", "Metro", "Upper", "Lower"])} ${rng.pick(CONF_SUFFIX)}`) &&
          usedConfNames.has(name)
        );
        short = name
          .split(" ")
          .filter((w) => /^[A-Z]/.test(w))
          .map((w) => w[0])
          .join("")
          .slice(0, 5);
      }
      usedConfNames.add(name);
      const id = `col-${div.toLowerCase()}-${slug(short)}-${hashString(rawConf).toString(36).slice(0, 4)}`;
      confIdByRaw.set(`${div}:${rawConf}`, id);
      conferences.push({ id, league: "college", name, short, tier: div });

      const used = new Set<string>();
      const confStrength = div === "D1" ? (D1_CONF[rawConf]?.[2] ?? 0.4) : div === "D2" ? 0.22 : 0.12;
      for (const m of members) {
        const tid = `col-${slug(m.name)}`;
        const rng = new Rng(tid);
        const [nick, icon] = pickNickname(rng, m.avoidNickname ?? "", used);
        const pal = rng.pick(PALETTES);
        const history = div === "D1" ? Math.min(1, ((m.tourneyApps ?? 0) / 40) * 0.6 + ((m.finalFours ?? 0) / 10) * 0.25 + ((m.titles ?? 0) / 5) * 0.15) : 0;
        const prestige = Math.max(0.02, Math.min(0.99, confStrength * 0.72 + history * 0.3 + rng.range(-0.08, 0.08)));
        const cap = div === "D1" ? Math.round(rng.range(3500, 9000) + prestige * 12000) : div === "D2" ? rng.int(1200, 4500) : rng.int(500, 2500);
        teams.push({
          id: teams.some((t) => t.id === tid) ? `${tid}-${div.toLowerCase()}` : tid,
          league: "college",
          name: m.name,
          nickname: nick,
          abbrev: makeAbbrev("college", m.name),
          city: m.city,
          state: m.state,
          colors: { primary: pal[0], secondary: pal[1], accent: pal[2] },
          logo: makeLogo(rng, m.name, icon),
          conferenceId: id,
          tier: div,
          prestige: Math.round(prestige * 100) / 100,
          arena: { name: `${m.name.split(" ")[0]} ${rng.pick(ARENA_SUFFIX)}`, capacity: cap },
        });
      }
    }
  }
  return { conferences, teams };
}

// ---------------------------------------------------------------------------
// High school (Arizona)
// ---------------------------------------------------------------------------

interface HsRaw {
  name: string;
  classification: string;
  region: string;
  enrollment: number | null;
}

function buildHs() {
  const raw = read<HsRaw[]>("aia-boys-basketball-2026.json");
  const cities = read<Record<string, string>>("aia-cities.json");
  // which levels each school fields (varsity, JV, JV 2, freshman/sophomore), from the AIA's AZPreps365 team pages
  const levels = read<{ levels: Record<string, TeamLevel[]> }>("aia-team-levels-2026.json").levels;
  const conferences: Conference[] = [];
  const teams: Team[] = [];
  const classBase: Record<string, number> = { "6A": 0.62, "5A": 0.52, "4A": 0.42, "3A": 0.34, "2A": 0.26, "1A": 0.18 };
  const enrollBase: Record<string, number> = { "6A": 2400, "5A": 1700, "4A": 1100, "3A": 600, "2A": 300, "1A": 120 };

  for (const cls of ["6A", "5A", "4A", "3A", "2A", "1A"]) {
    const regions = [...new Set(raw.filter((r) => r.classification === cls).map((r) => r.region))];
    for (const region of regions) {
      const id = `hs-${cls.toLowerCase()}-${slug(region)}`;
      conferences.push({ id, league: "hs", name: `${cls} ${region} Region`, short: `${cls} ${region}`, tier: cls as Team["tier"] });
      const used = new Set<string>();
      for (const s of raw.filter((r) => r.classification === cls && r.region === region)) {
        const tid = `hs-${slug(s.name)}`;
        const rng = new Rng(tid);
        const [nick, icon] = pickNickname(rng, "", used);
        const pal = rng.pick(PALETTES);
        const enroll = s.enrollment ?? enrollBase[cls];
        const sizeBoost = Math.min(0.12, (enroll / enrollBase[cls] - 1) * 0.08);
        const prestige = Math.max(0.05, Math.min(0.95, classBase[cls] + sizeBoost + rng.range(-0.14, 0.16)));
        const city = cities[s.name] ?? "Phoenix";
        const display = s.name
          .replace(/^ALA - /, "American Leadership Academy ")
          .replace(/^ALA$/, "American Leadership Academy")
          .replace("Heritage Acad ", "Heritage Academy ")
          .replace(" Jr. / Sr.", "")
          .replace(" Jr./Sr.", "");
        teams.push({
          id: tid,
          league: "hs",
          name: display,
          nickname: nick,
          abbrev: makeAbbrev("hs", display),
          city,
          state: "AZ",
          colors: { primary: pal[0], secondary: pal[1], accent: pal[2] },
          logo: makeLogo(rng, display, icon),
          conferenceId: id,
          tier: cls as Team["tier"],
          prestige: Math.round(prestige * 100) / 100,
          arena: {
            name: `${display.split(" (")[0]} ${rng.pick(["Gymnasium", "Gym", "Fieldhouse", "Activity Center", "Event Center"])}`,
            capacity: Math.round(400 + Math.min(4500, enroll * 1.2)),
          },
          levels: levels[s.name] ?? ["varsity", "jv"],
        });
      }
    }
  }
  return { conferences, teams };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Real-identity exceptions requested by the project owner. Everything else stays
// original. Brophy College Preparatory: Broncos, red and white.
const IDENTITY_OVERRIDES: Record<string, Partial<Team>> = {
  "hs-brophy-prep": {
    nickname: "Broncos",
    colors: { primary: "#b5121b", secondary: "#ffffff", accent: "#ffffff" },
    logo: { shape: "shield", icon: "horn", monogram: "BP", stripe: false, image: "/logos/brophy.png" },
    arena: { name: "Brophy Gymnasium", capacity: 2200 },
  },
};

function applyOverrides(teams: Team[]) {
  for (const t of teams) {
    const o = IDENTITY_OVERRIDES[t.id];
    if (o) Object.assign(t, o);
  }
}

fs.mkdirSync(OUT, { recursive: true });
const out = { pro: buildPro(), college: buildCollege(), hs: buildHs() };
for (const v of Object.values(out)) applyOverrides(v.teams);
for (const [k, v] of Object.entries(out)) {
  fs.writeFileSync(path.join(OUT, `${k}.json`), JSON.stringify(v));
  console.log(`${k}: ${v.teams.length} teams, ${v.conferences.length} conferences`);
}
const ids = new Set<string>();
for (const v of Object.values(out))
  for (const t of v.teams) {
    if (ids.has(t.id)) throw new Error(`duplicate team id ${t.id}`);
    ids.add(t.id);
  }
