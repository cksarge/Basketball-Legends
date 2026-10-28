import type { Metadata } from "next";
import { CareerCreator } from "./CareerCreator";

export const metadata: Metadata = {
  title: "Create a player",
  description: "Build your career player: name, hometown, school, position, archetype, body, look and starting skills.",
};

export default function NewCareerPage() {
  return <CareerCreator />;
}
