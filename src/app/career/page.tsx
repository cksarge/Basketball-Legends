import type { Metadata } from "next";
import { CareerSelect } from "./CareerSelect";

export const metadata: Metadata = {
  title: "Road to Legend",
  description: "Create a player and go from Arizona high school freshman to Basketball Legend.",
};

export default function CareerPage() {
  return <CareerSelect />;
}
