// Play in the Park venues. Every park is original; the cities are real places.
// The 3D scene (src/game3d/park/ParkScene.tsx) builds each setting from this description.

export type ParkSetting = "desert" | "cage" | "beach" | "neighborhood" | "rooftop";
export type ParkTime = "day" | "sunset" | "night";

export interface ParkSurface {
  /** Playing surface inside the lines. */
  court: string;
  /** The painted lane. */
  key: string;
  /** Out of bounds, up to the fence. */
  apron: string;
  lines: string;
  /** "asphalt" shows cracks, patches and wear; "acrylic" is a newer painted sport surface. */
  finish: "asphalt" | "acrylic";
}

export interface Park {
  id: string;
  name: string;
  city: string;
  state: string;
  blurb: string;
  setting: ParkSetting;
  time: ParkTime;
  surface: ParkSurface;
  hoop: { board: "steel" | "acrylic"; net: "chain" | "nylon" };
  /** How good the regulars are (overall range). */
  level: [number, number];
  /** Shown on the setup screen. */
  vibe: string;
  /** Who's watching: the share of spectator spots filled, how loud they get (0..1), and what they wear. */
  crowd: { density: number; loudness: number; palette: string[] };
  /** The sound of the place under the game. */
  ambience: "desert" | "city" | "waves" | "night" | "rooftop";
}

export const PARKS: Park[] = [
  {
    id: "copper-flats",
    name: "Copper Flats Courts",
    city: "Phoenix",
    state: "AZ",
    blurb: "Two hoops, a ramada for shade and the mountains in the distance. Games start early before the heat.",
    setting: "desert",
    time: "day",
    surface: { court: "#3f7f6a", key: "#b4553c", apron: "#2f5f50", lines: "#f3f1ea", finish: "acrylic" },
    hoop: { board: "acrylic", net: "nylon" },
    level: [42, 66],
    vibe: "Friendly runs",
    crowd: { density: 0.75, loudness: 0.35, palette: ["#f4f4f2", "#e66b1f", "#0c7c8c", "#d8c9a8", "#7b1e3a", "#1f4e9a", "#f2a900"] },
    ambience: "desert",
  },
  {
    id: "ironside-cage",
    name: "Ironside Cage",
    city: "New York",
    state: "NY",
    blurb: "A tight court behind a twelve-foot fence, brick walls on three sides, and a crowd pressed against the chain link.",
    setting: "cage",
    time: "sunset",
    surface: { court: "#4a4d52", key: "#7a2f2b", apron: "#3b3d41", lines: "#f0eee6", finish: "asphalt" },
    hoop: { board: "steel", net: "chain" },
    level: [55, 78],
    vibe: "Tough, physical games",
    crowd: { density: 0.95, loudness: 0.85, palette: ["#1d1f23", "#f4f4f2", "#8d9399", "#c8102e", "#2a3550", "#3b2f2a", "#f2a900"] },
    ambience: "city",
  },
  {
    id: "boardwalk",
    name: "Boardwalk Courts",
    city: "Los Angeles",
    state: "CA",
    blurb: "Sand on one side, the ocean on the other, and runs that go until the sun drops into the water.",
    setting: "beach",
    time: "sunset",
    surface: { court: "#2f6aa3", key: "#d9a441", apron: "#245584", lines: "#ffffff", finish: "acrylic" },
    hoop: { board: "acrylic", net: "nylon" },
    level: [48, 72],
    vibe: "Showtime crowd",
    crowd: { density: 1, loudness: 1, palette: ["#f4f4f2", "#f2a900", "#e66b1f", "#0c7c8c", "#c8102e", "#6a1b9a", "#7fd1c7", "#ff8fb1"] },
    ambience: "waves",
  },
  {
    id: "maple-street",
    name: "Maple Street Park",
    city: "Chicago",
    state: "IL",
    blurb: "A neighborhood blacktop under the lights, with houses across the street and the next five waiting by the fence.",
    setting: "neighborhood",
    time: "night",
    surface: { court: "#3a3c3f", key: "#2f5d8a", apron: "#2f3134", lines: "#ecebe4", finish: "asphalt" },
    hoop: { board: "steel", net: "chain" },
    level: [38, 62],
    vibe: "Weekend warriors",
    crowd: { density: 0.8, loudness: 0.45, palette: ["#1d1f23", "#2a3550", "#8d9399", "#2e7d32", "#7b1e3a", "#d8c9a8", "#14365e"] },
    ambience: "night",
  },
  {
    id: "rooftop-ninth",
    name: "Rooftop on Ninth",
    city: "Kansas City",
    state: "MO",
    blurb: "A court on top of a parking garage, the skyline lit up all around. Invite-only runs with former college players.",
    setting: "rooftop",
    time: "night",
    surface: { court: "#7a3b3b", key: "#2a2c33", apron: "#5a5d63", lines: "#f5f2ea", finish: "acrylic" },
    hoop: { board: "acrylic", net: "nylon" },
    level: [58, 80],
    vibe: "High-level runs",
    crowd: { density: 0.9, loudness: 0.6, palette: ["#1d1f23", "#f4f4f2", "#2a2d33", "#6a1b9a", "#c9a227", "#14365e", "#7b1e3a"] },
    ambience: "rooftop",
  },
];

export const parkById = (id: string) => PARKS.find((p) => p.id === id) ?? PARKS[0];
