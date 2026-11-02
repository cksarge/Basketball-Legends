// League rules the user can change, and which systems run themselves.
import type { AutoKey, LeagueSettings } from "./types";

export const DEFAULT_LEAGUE: LeagueSettings = {
  gamesPerSeason: 82,
  playoffFormat: { firstRoundBestOf: 7, playIn: true },
  tradeDifficulty: "normal",
  injuries: "normal",
  progression: "normal",
};

/** Only the roster runs itself to start with, so a sim is never blocked by surprise. */
export const DEFAULT_AUTO: Record<AutoKey, boolean> = {
  tactics: false,
  practice: false,
  scouting: false,
  draft: false,
  contracts: false,
  freeAgency: false,
  trades: false,
  finances: false,
  roster: true,
};
