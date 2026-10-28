import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { ProsePage } from "@/ui/Prose";
import { Markdown } from "@/ui/Markdown";

export const metadata: Metadata = { title: "Changelog", description: "Release notes for every version of Basketball Legends." };

export default function Changelog() {
  // read at build time; the static export bakes it into the page
  const source = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  return (
    <ProsePage title="Changelog">
      <p className="text-steel">
        You&apos;re playing version {process.env.APP_VERSION}. Versions follow MAJOR.MINOR.PATCH: a new phase of the game bumps the minor number, fixes bump the
        patch number, and 1.0.0 will be the first complete release.
      </p>
      <Markdown source={source} />
    </ProsePage>
  );
}
