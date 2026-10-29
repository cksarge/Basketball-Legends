import type { Metadata } from "next";
import { LogoLab } from "./LogoLab";

export const metadata: Metadata = { title: "Logo lab", robots: { index: false } };

export default function LogoPage() {
  return <LogoLab />;
}
