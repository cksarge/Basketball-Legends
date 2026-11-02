import type { Metadata } from "next";
import { Suspense } from "react";
import { FranchiseHub } from "./FranchiseHub";

export const metadata: Metadata = {
  title: "Franchise hub",
  description: "Your franchise: schedule, roster, standings and what's next.",
  robots: { index: false },
};

export default function FranchiseHubPage() {
  return (
    <Suspense>
      <FranchiseHub />
    </Suspense>
  );
}
