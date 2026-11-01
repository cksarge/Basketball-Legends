import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { IS_BETA, SITE_URL } from "@/lib/site";
import { ProsePage } from "@/ui/Prose";
import { Markdown } from "@/ui/Markdown";

export const metadata: Metadata = { title: "Changelog", description: "Release notes for every version of Basketball Legends." };

export default function Changelog() {
  // read at build time; the static export bakes it into the page
  const source = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  return (
    <ProsePage title="Changelog">
      <p className="text-steel">
        You&apos;re playing version {process.env.APP_VERSION}.{" "}
        <a className="text-amber underline" href={IS_BETA ? `${SITE_URL}/` : `${SITE_URL}/beta/`}>
          {IS_BETA ? "Play the main version by clicking here." : "Play the beta version by clicking here."}
        </a>
      </p>
      <Markdown source={source} />
    </ProsePage>
  );
}
