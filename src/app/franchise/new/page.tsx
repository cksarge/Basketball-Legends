import type { Metadata } from "next";
import { FranchiseCreator } from "./FranchiseCreator";

export const metadata: Metadata = {
  title: "New franchise",
  description: "Pick a team and start a franchise.",
};

export default function NewFranchisePage() {
  return <FranchiseCreator />;
}
