import type { Metadata } from "next";
import { H2, ProsePage } from "@/ui/Prose";

export const metadata: Metadata = { title: "Terms of Service", description: "The terms for playing Basketball Legends." };

export default function Terms() {
  return (
    <ProsePage title="Terms of Service" updated="October 27, 2026">
      <p>
        These terms apply to the Basketball Legends website at legends.carterscoding.com and the game it serves (together, &quot;the game&quot;). By playing,
        you agree to them. If you don&apos;t agree, please don&apos;t use the game.
      </p>
      <H2>A free fan project</H2>
      <p>
        The game is free, non-commercial and open source. There are no purchases, ads or subscriptions. The source code is licensed under the MIT License; that
        license, not these terms, governs your use of the code itself.
      </p>
      <H2>No affiliation</H2>
      <p>
        Basketball Legends is not affiliated with, endorsed by or sponsored by the NBA, the NCAA, the Arizona Interscholastic Association, or any professional
        team, college, university or high school. Real city and school names are used only to identify places and institutions. Team nicknames, logos, colors,
        conferences, arenas and all players are fictional, except that Brophy College Preparatory appears with its real nickname (Broncos) and school colors,
        which remain the property of the school. Any resemblance between a generated player and a real person is coincidental.
      </p>
      <H2>Your content</H2>
      <p>
        The game lets you edit rosters and import roster files. Those files stay on your device. You are responsible for anything you create, import or share,
        and you agree not to use the game to infringe anyone&apos;s rights, impersonate real people (including minors), or share unlawful content.
      </p>
      <H2>Saves and settings</H2>
      <p>
        Settings and saved games are stored in your browser. Clearing your browser data, using a private window or switching devices can remove them. Please
        export saves you care about. To play offline, your browser also keeps a cached copy of the game&apos;s files; clearing site data removes it, and it
        downloads again on your next visit.
      </p>
      <H2>No warranty</H2>
      <p>
        The game is provided &quot;as is&quot;, without warranties of any kind. It may have bugs, change, or become unavailable at any time. To the fullest
        extent allowed by law, the creator is not liable for any damages arising from your use of the game.
      </p>
      <H2>Health</H2>
      <p>
        Take breaks. If you experience discomfort, dizziness or symptoms of photosensitivity while playing, stop and rest. Reduce motion and other accessibility
        options are available in Settings.
      </p>
      <H2>Changes</H2>
      <p>
        These terms may be updated as the game grows, for example when online play arrives. The date above shows the latest version. Continuing to play after an
        update means you accept the new terms.
      </p>
      <H2>Contact</H2>
      <p>
        Questions or concerns, including takedown requests, can be raised by opening an issue on the project&apos;s{" "}
        <a className="text-amber underline" href="https://github.com/cksarge/Basketball-Legends/issues">
          GitHub repository
        </a>
        .
      </p>
    </ProsePage>
  );
}
