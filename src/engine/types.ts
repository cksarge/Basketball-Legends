// Core domain types shared by the sim engine, 3D game, and UI.

export type LeagueId = "pro" | "college" | "hs";
export type CollegeDivision = "D1" | "D2" | "D3";
export type HsClass = "6A" | "5A" | "4A" | "3A" | "2A" | "1A";
export type Position = "PG" | "SG" | "SF" | "PF" | "C";
export const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

export interface TeamColors {
  primary: string;
  secondary: string;
  accent: string;
}

/** Procedural logo description, rendered to SVG/canvas by src/ui/Logo. */
export interface LogoSpec {
  shape: "circle" | "shield" | "diamond" | "hex" | "roundel" | "star" | "badge";
  icon: LogoIcon;
  monogram: string;
  stripe: boolean;
}

export type LogoIcon =
  | "ball" | "flame" | "bolt" | "star" | "crown" | "wing" | "claw" | "mountain"
  | "wave" | "sun" | "tree" | "horn" | "shield" | "arrow" | "paw" | "feather"
  | "anchor" | "gear" | "moon" | "none";

export interface Team {
  id: string;
  league: LeagueId;
  /** City / school name, e.g. "Phoenix" or "Arizona State". */
  name: string;
  nickname: string;
  abbrev: string;
  city: string;
  state: string;
  colors: TeamColors;
  logo: LogoSpec;
  conferenceId: string;
  divisionId?: string;
  /** College division or HS classification. */
  tier?: CollegeDivision | HsClass;
  /** 0..1 program strength; drives roster talent and recruiting appeal. */
  prestige: number;
  arena: { name: string; capacity: number };
}

export interface Conference {
  id: string;
  league: LeagueId;
  name: string;
  short: string;
  tier?: CollegeDivision | HsClass;
  divisions?: { id: string; name: string }[];
}

/** All ratings are 25..99. */
export interface Ratings {
  // physical
  speed: number;
  accel: number;
  strength: number;
  vertical: number;
  stamina: number;
  durability: number;
  // scoring
  closeShot: number;
  layup: number;
  dunk: number;
  midRange: number;
  three: number;
  freeThrow: number;
  postControl: number;
  drawFoul: number;
  // playmaking
  ballHandle: number;
  speedWithBall: number;
  passAccuracy: number;
  passVision: number;
  // defense
  interiorD: number;
  perimeterD: number;
  steal: number;
  block: number;
  offReb: number;
  defReb: number;
  // mental
  iq: number;
  hustle: number;
  clutch: number;
}

export type RatingKey = keyof Ratings;

export const RATING_GROUPS: Record<string, RatingKey[]> = {
  Physical: ["speed", "accel", "strength", "vertical", "stamina", "durability"],
  Scoring: ["closeShot", "layup", "dunk", "midRange", "three", "freeThrow", "postControl", "drawFoul"],
  Playmaking: ["ballHandle", "speedWithBall", "passAccuracy", "passVision"],
  Defense: ["interiorD", "perimeterD", "steal", "block", "offReb", "defReb"],
  Mental: ["iq", "hustle", "clutch"],
};

export const RATING_LABELS: Record<RatingKey, string> = {
  speed: "Speed", accel: "Acceleration", strength: "Strength", vertical: "Vertical",
  stamina: "Stamina", durability: "Durability", closeShot: "Close Shot", layup: "Layup",
  dunk: "Dunk", midRange: "Mid-Range", three: "Three-Point", freeThrow: "Free Throw",
  postControl: "Post Control", drawFoul: "Draw Foul", ballHandle: "Ball Handle",
  speedWithBall: "Speed w/ Ball", passAccuracy: "Pass Accuracy", passVision: "Pass Vision",
  interiorD: "Interior D", perimeterD: "Perimeter D", steal: "Steal", block: "Block",
  offReb: "Off. Rebound", defReb: "Def. Rebound", iq: "Basketball IQ", hustle: "Hustle",
  clutch: "Clutch",
};

export type Archetype =
  | "Floor General" | "Shot Creator" | "Sharpshooter" | "Slasher" | "3&D Wing"
  | "Two-Way Wing" | "Stretch Big" | "Post Scorer" | "Rim Protector" | "Glass Cleaner"
  | "Playmaking Big" | "Athletic Finisher";

export interface Appearance {
  skinTone: number; // index into SKIN_TONES
  hairStyle: number;
  hairColor: number;
  facialHair: number;
  headband: boolean;
  armSleeve: "none" | "left" | "right";
  kneePads: boolean;
  shoeColor: string;
  faceShape: number; // 0..1 blend
  build: number; // 0 lean .. 1 heavy
}

export type ClassYear = "FR" | "SO" | "JR" | "SR" | "GR";

export interface Contract {
  salary: number; // per season, in dollars
  years: number; // remaining seasons including current
  rookie?: boolean;
  twoWay?: boolean;
  playerOption?: boolean;
  teamOption?: boolean;
}

export interface Injury {
  name: string;
  gamesOut: number;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  pos: Position;
  secondaryPos?: Position;
  heightIn: number;
  weightLb: number;
  wingspanIn: number;
  age: number;
  hometown: string;
  archetype: Archetype;
  ratings: Ratings;
  /** Expected peak overall. */
  potential: number;
  jersey: number;
  teamId: string | null;
  classYear?: ClassYear;
  contract?: Contract;
  appearance: Appearance;
  badges: string[];
  injury?: Injury;
  /** Hidden 0..1 traits. */
  traits: { workEthic: number; ego: number; loyalty: number; consistency: number };
  /** Is this the user's career player. */
  isUser?: boolean;
}

export interface TeamTactics {
  pace: number; // 0..1
  threeRate: number; // 0..1 preference for threes
  defense: "man" | "zone23" | "zone32" | "press";
  crashBoards: number; // 0..1
  doubleTeamStars: boolean;
}

export interface LeagueRules {
  quarterMinutes: number;
  periods: number; // 4 quarters or 2 halves
  shotClock: number | null;
  threePointFt: number;
  cornerThreeFt: number;
  overtimeMinutes: number;
  foulOutLimit: number;
  bonusFouls: number;
  backcourtSeconds: number;
}

export const LEAGUE_RULES: Record<LeagueId, LeagueRules> = {
  pro: { quarterMinutes: 12, periods: 4, shotClock: 24, threePointFt: 23.75, cornerThreeFt: 22, overtimeMinutes: 5, foulOutLimit: 6, bonusFouls: 5, backcourtSeconds: 8 },
  college: { quarterMinutes: 20, periods: 2, shotClock: 30, threePointFt: 22.15, cornerThreeFt: 21.65, overtimeMinutes: 5, foulOutLimit: 5, bonusFouls: 7, backcourtSeconds: 10 },
  hs: { quarterMinutes: 8, periods: 4, shotClock: 35, threePointFt: 19.75, cornerThreeFt: 19.75, overtimeMinutes: 4, foulOutLimit: 5, bonusFouls: 5, backcourtSeconds: 10 },
};
