// School: semester grades from classroom aptitude, how you split your time, and a finals-week quiz.
// AIA eligibility needs passing grades; here a fall GPA under 2.0 sits you for the rest of the season.
import { Rng, clamp } from "@/engine/rng";

export const ELIGIBLE_GPA = 2.0;
/** NCAA Division I initial-eligibility core GPA (used by recruiting). */
export const D1_GPA = 2.3;

/**
 * Semester GPA: aptitude sets the base, time spent on school (focus) and the finals score move it.
 * `exam` is 0..1 (0.5 when the quiz is skipped).
 */
export function semesterGpa(academics: number, focus: number, exam: number, rng: Rng) {
  const g = 1.9 + academics * 1.9 + (focus - 0.5) * 1.1 + (exam - 0.5) * 1.0 + rng.normal(0, 0.12);
  return Math.round(clamp(g, 0.5, 4.0) * 100) / 100;
}

/** Practice XP multiplier from focus: all basketball 1.3x, balanced 1x, all school 0.7x. */
export const practiceMultiplier = (focus: number) => 1.3 - focus * 0.6;

export const gpaLabel = (g: number) => (g >= 3.7 ? "Honor roll" : g >= 3.0 ? "Good standing" : g >= ELIGIBLE_GPA ? "Passing" : "Academically ineligible");

export interface QuizQuestion {
  prompt: string;
  choices: string[];
  answer: number;
}

const SUBJECTS = ["Algebra", "Geometry", "Chemistry", "Spanish", "History", "English"] as const;

/** Eight quick finals questions (mental math and vocabulary), deterministic for a seed. */
export function finalsQuiz(seed: string, grade: number): QuizQuestion[] {
  const rng = new Rng(`quiz:${seed}`);
  const qs: QuizQuestion[] = [];
  const vocab: [string, string, string[]][] = [
    ["Spanish", "What does “biblioteca” mean?", ["Library", "Bookstore", "Notebook", "Teacher"]],
    ["Spanish", "What does “ventana” mean?", ["Window", "Wind", "Sale", "Door"]],
    ["English", "Which word means “brief and to the point”?", ["Concise", "Verbose", "Obscure", "Lavish"]],
    ["English", "Which word means “to make worse”?", ["Exacerbate", "Alleviate", "Elevate", "Mitigate"]],
    ["History", "Arizona became a state in which year?", ["1912", "1848", "1901", "1924"]],
    ["History", "The Grand Canyon was carved mainly by which river?", ["Colorado", "Gila", "Salt", "Rio Grande"]],
    ["Chemistry", "What is the chemical symbol for sodium?", ["Na", "So", "Sd", "S"]],
    ["Chemistry", "Water is made of hydrogen and…", ["Oxygen", "Nitrogen", "Carbon", "Helium"]],
    ["Geometry", "How many degrees are in a triangle?", ["180", "90", "360", "270"]],
    ["Geometry", "A free throw is 15 feet from the backboard. What's that in yards?", ["5", "3", "4.5", "6"]],
  ];
  const facts = rng.shuffle([...vocab]).slice(0, 4);
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 1 && facts.length) {
      const [, prompt, opts] = facts.pop()!;
      const order = rng.shuffle([0, 1, 2, 3]);
      qs.push({ prompt, choices: order.map((o) => opts[o]), answer: order.indexOf(0) });
      continue;
    }
    // mental math gets harder each year
    const hard = grade >= 11;
    const a = rng.int(hard ? 12 : 6, hard ? 48 : 24),
      b = rng.int(3, hard ? 19 : 12);
    const kind = rng.int(0, 2);
    const [prompt, value] = kind === 0 ? [`${a} × ${b}`, a * b] : kind === 1 ? [`${a * b} ÷ ${b}`, a] : [`${a} + ${b} × 3`, a + b * 3];
    const wrong = new Set<number>();
    while (wrong.size < 3) {
      const w = value + rng.int(-12, 12);
      if (w !== value && w > 0) wrong.add(w);
    }
    const choices = rng.shuffle([value, ...wrong]);
    qs.push({ prompt: `${SUBJECTS[i % 2 ? 2 : 0]}: ${prompt} = ?`, choices: choices.map(String), answer: choices.indexOf(value) });
  }
  return qs;
}
