import type { Metadata } from "next";
import { SettingsView } from "./SettingsView";

export const metadata: Metadata = { title: "Settings", description: "Graphics, audio, gameplay, camera, control remapping and accessibility options for Basketball Legends." };

export default function SettingsPage() {
  return <SettingsView />;
}
