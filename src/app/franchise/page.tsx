import type { Metadata } from "next";
import { FranchiseSelect } from "./FranchiseSelect";

export const metadata: Metadata = {
  title: "Franchise",
  description: "Coach and run a team for as many seasons as you like.",
};

export default function FranchisePage() {
  return <FranchiseSelect />;
}
