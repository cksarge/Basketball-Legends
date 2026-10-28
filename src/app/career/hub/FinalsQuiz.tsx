"use client";
// Finals week: eight quick questions against the clock. Number keys 1-4 answer too.
import { useEffect, useMemo, useState } from "react";
import { finalsQuiz } from "@/career/hs/academics";
import { Button, Panel } from "@/ui/kit";

export const QUIZ_SECONDS = 60;

export function FinalsQuiz({ seed, grade, semester, onDone }: { seed: string; grade: number; semester: "fall" | "spring"; onDone: (score: number) => void }) {
  const questions = useMemo(() => finalsQuiz(seed, grade), [seed, grade]);
  const [i, setI] = useState(0);
  const [right, setRight] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [left, setLeft] = useState(QUIZ_SECONDS);
  const [started, setStarted] = useState(false);
  const done = i >= questions.length || left <= 0;

  useEffect(() => {
    if (!started || done) return;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, [started, done]);

  const answer = (k: number) => {
    if (picked !== null || done) return;
    setPicked(k);
    if (k === questions[i].answer) setRight((r) => r + 1);
    setTimeout(() => {
      setPicked(null);
      setI((n) => n + 1);
    }, 450);
  };

  useEffect(() => {
    if (!started) return;
    const h = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) answer(n - 1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!started)
    return (
      <Panel title={`${semester === "fall" ? "Fall" : "Spring"} finals`}>
        <p className="mb-4 text-steel">
          Eight questions, {QUIZ_SECONDS} seconds. Your score, your classroom aptitude and how much time you put into school decide your GPA. Keep it at 2.0 or
          above to stay eligible.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => setStarted(true)}>Start the exam</Button>
          <Button variant="ghost" onClick={() => onDone(0.5)}>
            Skip (average score)
          </Button>
        </div>
      </Panel>
    );

  if (done)
    return (
      <Panel title="Pencils down">
        <p className="mb-4">
          You got {right} of {questions.length} right.
        </p>
        <Button onClick={() => onDone(right / questions.length)}>See your grades</Button>
      </Panel>
    );

  const q = questions[i];
  return (
    <Panel>
      <div className="mb-3 flex justify-between text-sm text-steel">
        <span>
          Question {i + 1} of {questions.length}
        </span>
        <span className={left <= 10 ? "text-bad" : ""}>{left}s</span>
      </div>
      <p className="mb-4 font-display text-2xl font-black">{q.prompt}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.choices.map((choice, k) => (
          <button
            key={k}
            onClick={() => answer(k)}
            className={`rounded-[var(--radius-chip)] px-4 py-3 text-left ring-1 ${
              picked === null
                ? "bg-deck-2 ring-line hover:ring-steel"
                : k === q.answer
                  ? "bg-good/30 ring-good"
                  : k === picked
                    ? "bg-bad/30 ring-bad"
                    : "bg-deck-2 ring-line"
            }`}
          >
            <span className="mr-2 text-steel">{k + 1}</span>
            {choice}
          </button>
        ))}
      </div>
    </Panel>
  );
}
