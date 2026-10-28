// Display helpers for career screens.
import type { CareerStage, HsLevel, IsoDate } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2, 2026" (dates are calendar days, so no time zone math). */
export function formatDate(d: IsoDate) {
  const [y, m, day] = d.split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

export function stageLabel(s: CareerStage) {
  return s === "hs" ? "High school" : s === "college" ? "College" : s === "pro" ? "Pro" : "Retired";
}

export const LEVEL_LABEL: Record<HsLevel, string> = { frso: "Freshman/Sophomore", jv: "Junior Varsity", varsity: "Varsity" };
export const LEVEL_SHORT: Record<HsLevel, string> = { frso: "FR/SO", jv: "JV", varsity: "Varsity" };

export const GRADE_LABEL: Record<number, string> = { 9: "Freshman", 10: "Sophomore", 11: "Junior", 12: "Senior" };
