import type { Metadata } from "next";
import { AnimLab } from "./AnimLab";

export const metadata: Metadata = { title: "Animation lab", robots: { index: false } };

export default function AnimPage() {
  return <AnimLab />;
}
