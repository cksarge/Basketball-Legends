import type { Metadata } from "next";
import { PageShell } from "@/ui/kit";
import { ParkMenu } from "./ParkMenu";

export const metadata: Metadata = {
  title: "Play in the Park",
  description: "Pickup basketball at five outdoor courts: 1-on-1 to 5-on-5, next game up, 21, HORSE and a 3-point contest.",
};

export default function ParkPage() {
  return (
    <PageShell title="Play in the Park" wide>
      <ParkMenu />
    </PageShell>
  );
}
