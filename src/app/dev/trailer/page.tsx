import type { Metadata } from "next";
import { TrailerLab } from "./TrailerLab";

export const metadata: Metadata = { title: "Trailer lab", robots: { index: false } };

export default function TrailerPage() {
  return <TrailerLab />;
}
