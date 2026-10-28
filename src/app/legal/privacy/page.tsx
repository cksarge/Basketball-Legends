import type { Metadata } from "next";
import { H2, ProsePage } from "@/ui/Prose";

export const metadata: Metadata = { title: "Privacy Policy", description: "What Basketball Legends stores, where, and why." };

export default function Privacy() {
  return (
    <ProsePage title="Privacy Policy" updated="October 28, 2026">
      <p>Basketball Legends is built to work without collecting personal information. There are no accounts, ads, analytics, tracking pixels or cookies.</p>
      <H2>What stays on your device</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Settings</b> (graphics, audio, controls, accessibility) are saved in your browser&apos;s local storage.
        </li>
        <li>
          <b>The current match setup</b> is kept in session storage so a page reload doesn&apos;t lose it. It clears when you close the tab.
        </li>
        <li>
          <b>A game in progress</b> is saved in local storage every few seconds so you can resume it from the main menu after closing the tab or choosing Save
          and quit. It is deleted when the game ends, when you quit without saving, or when you discard it.
        </li>
        <li>
          <b>Careers</b> are saved in your browser&apos;s IndexedDB storage after everything you do. Exporting a career downloads a .blcareer file to your
          device; nothing is uploaded.
        </li>
        <li>
          <b>Saved games and roster files</b> you create are stored in your browser and never uploaded.
        </li>
        <li>
          <b>An offline copy of the game</b> (pages, code, the 3D players and venues, and images; about 12 MB) is kept in your browser&apos;s cache by a service
          worker so the game loads and plays without an internet connection. It contains only the game&apos;s own files, nothing about you.
        </li>
        <li>
          <b>Instant replays and highlights</b> are recorded in memory during a game and discarded when you leave it.
        </li>
        <li>
          <b>The beta</b> at legends.carterscoding.com/beta/ reads and writes the same settings and saved games as the main game, and keeps its own offline copy
          of its files in your browser&apos;s cache. Like the main game, it sends nothing about you anywhere.
        </li>
      </ul>
      <p>You can remove all of this at any time by clearing this site&apos;s data in your browser settings.</p>
      <H2>Hosting</H2>
      <p>
        The site is hosted on GitHub Pages. GitHub may log technical information such as IP addresses when your browser requests the site&apos;s files, as
        described in the{" "}
        <a className="text-amber underline" href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">
          GitHub Privacy Statement
        </a>
        . The game itself doesn&apos;t receive or store that information.
      </p>
      <H2>Browser features the game uses</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Gamepads</b> are read through your browser&apos;s Gamepad API. Button presses never leave your device.
        </li>
        <li>
          <b>Spoken commentary</b> (off by default) uses your browser&apos;s built-in speech voices. Some browsers send that text to the browser maker&apos;s
          speech service. Leave it off if you prefer, and text commentary still works.
        </li>
        <li>
          <b>Graphics auto-detect</b> reads your graphics card&apos;s name locally to choose a preset. It isn&apos;t sent anywhere.
        </li>
      </ul>
      <H2>Children</H2>
      <p>
        The game doesn&apos;t knowingly collect information from anyone, including children. All players in the game are fictional, including those on high
        school rosters.
      </p>
      <H2>Future online features</H2>
      <p>
        Optional accounts, cloud saves, leaderboards and online play are planned. When they arrive, this policy will be updated before they go live to explain
        exactly what is collected and how to delete it. Playing offline will stay available without an account.
      </p>
      <H2>Contact</H2>
      <p>
        Privacy questions can be raised by opening an issue on the project&apos;s{" "}
        <a className="text-amber underline" href="https://github.com/cksarge/Basketball-Legends/issues">
          GitHub repository
        </a>
        .
      </p>
    </ProsePage>
  );
}
