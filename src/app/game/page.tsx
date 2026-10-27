import type { Metadata } from "next";
import { GamePageClient } from "./GamePageClient";

export const metadata: Metadata = { title: "Game", robots: { index: false } };

export default function GamePage() {
  return <GamePageClient />;
}
