// Which parks are open: two from the start, the rest earned with street reputation in Road to Legend.

/** The parks, easiest first, and the reputation each one takes. */
export const PARK_LADDER: { parkId: string; rep: number }[] = [
  { parkId: "copper-flats", rep: 0 },
  { parkId: "maple-street", rep: 0 },
  { parkId: "boardwalk", rep: 25 },
  { parkId: "ironside-cage", rep: 60 },
  { parkId: "rooftop-ninth", rep: 110 },
];

export const unlockedParks = (rep: number) => PARK_LADDER.filter((p) => rep >= p.rep).map((p) => p.parkId);
export const nextUnlock = (rep: number) => PARK_LADDER.find((p) => rep < p.rep) ?? null;
export const parkRepNeeded = (parkId: string) => PARK_LADDER.find((p) => p.parkId === parkId)?.rep ?? 0;
