import type { Metadata } from "next";
import { CareerSelect } from "./CareerSelect";

export const metadata: Metadata = {
  title: "Career",
  description: "Create a player and go from Arizona high school freshman to the Hall of Fame.",
};

export default function CareerPage() {
  return <CareerSelect />;
}
