import type { Metadata } from "next";
import { VenueLab } from "./VenueLab";

export const metadata: Metadata = { title: "Venue lab", robots: { index: false } };

export default function VenuesPage() {
  return <VenueLab />;
}
