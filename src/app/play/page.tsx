import type { Metadata } from "next";
import { Suspense } from "react";
import { QuickPlay } from "./QuickPlay";

export const metadata: Metadata = { title: "Quick Play", description: "Pick any two teams from the pro league, 1,092 colleges or every Arizona high school and play or simulate a game." };

export default function PlayPage() {
  return (
    <Suspense>
      <QuickPlay />
    </Suspense>
  );
}
