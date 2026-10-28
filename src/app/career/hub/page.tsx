import type { Metadata } from "next";
import { Suspense } from "react";
import { CareerHub } from "./CareerHub";

export const metadata: Metadata = {
  title: "Career hub",
  description: "Your career: schedule, stats, ratings, messages and what's next.",
  robots: { index: false },
};

export default function CareerHubPage() {
  return (
    <Suspense>
      <CareerHub />
    </Suspense>
  );
}
