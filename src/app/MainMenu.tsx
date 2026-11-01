"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Team } from "@/engine/types";
import { loadLeague } from "@/data/leagues";
import { useMatchStore } from "@/state/matchStore";
import { audio } from "@/audio/engine";
import { useInputDevice } from "@/ui/MenuNavigator";
import { KeyHint } from "@/ui/KeyHint";
import { toast } from "@/ui/Toaster";
import {
  clearSuspended,
  modeLabel,
  resumePending,
  type SaveGroup,
  type SaveSlot,
  slotLabel,
  SLOTS,
  type SuspendedGame,
  useSaves,
  whereText,
} from "@/state/suspended";
import { IS_BETA, SITE_URL } from "@/lib/site";

const MenuTrailer = dynamic(() => import("@/game3d/MenuTrailer"), { ssr: false });

interface Item {
  id: string;
  label: string;
  href?: string;
  blurb: string;
  detail: string[];
  soon?: boolean;
}

const ITEMS: Item[] = [
  {
    id: "quick",
    label: "Quick Play",
    href: "/play/",
    blurb: "Any two teams from any league, your rules.",
    detail: [
      "1,405 teams: pro, college and every Arizona high school",
      "Fast start with random teams, or set up every detail",
      "Up to four local players, or sim instantly",
    ],
  },
  {
    id: "career",
    label: "Road to Legend",
    href: "/career/",
    blurb: "Your career, from freshman year to basketball immortality. Few ever become Legends.",
    detail: [
      "Build your player and pick your Arizona high school",
      "Tryouts, recruiting, college and draft night",
      "Pro seasons, the Hall of Legends and the final verdict",
    ],
  },
  {
    id: "franchise",
    label: "Franchise",
    soon: true,
    blurb: "Coach and run a program for as many seasons as you like.",
    detail: ["Rotations, playbooks, trades, recruiting, the draft", "Play or sim every game", "Arrives in a later update"],
  },
  {
    id: "multiplayer",
    label: "Multiplayer",
    soon: true,
    blurb: "Play against other people online.",
    detail: ["Head-to-head games and online park runs", "Accounts and friends", "Arrives in a later update"],
  },
  {
    id: "park",
    label: "Play in the Park",
    href: "/park/",
    blurb: "Pickup ball at five outdoor courts.",
    detail: ["1-on-1 up to 5-on-5, half or full court", "Next game up, 21, HORSE and a 3-point contest", "Earn more parks in Road to Legend"],
  },
  {
    id: "practice",
    label: "Practice and Tutorial",
    href: "/play/?practice=1",
    blurb: "Learn the controls, or shoot around in an empty gym.",
    detail: ["A guided tutorial for every basic move", "Free shootaround with no clock and no defense", "Uses your own key and button bindings"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings/",
    blurb: "Graphics, audio, controls and accessibility.",
    detail: ["Remap every key and button", "Graphics presets with auto-detect", "Colorblind modes, subtitles, UI scale"],
  },
  {
    id: "howto",
    label: "How to play",
    href: "/how-to-play/",
    blurb: "Controls, the shot meter and game rules.",
    detail: ["Offense, defense and dribble moves", "Shot timing explained", "League rule differences"],
  },
];

/** The controller to play with from the menu: the gamepad if that's what was used last. */
export function MainMenu() {
  const router = useRouter();
  const [teams, setTeams] = useState<[Team, Team] | null>(null);
  const [focused, setFocused] = useState(ITEMS[0].id);
  const device = useInputDevice((s) => s.device);
  const setPending = useMatchStore((s) => s.setPending);
  const first = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const saves = useSaves();
  const items = useMemo<Item[]>(() => {
    if (!saves.length) return ITEMS;
    // the panel lists the autosave (if any) and every save slot
    return [
      {
        id: "resume",
        label: "Resume game",
        blurb: saves.length === 1 ? "1 game waiting where you left it." : `${saves.length} games waiting where you left them.`,
        detail: [],
      },
      ...ITEMS,
    ];
  }, [saves]);

  useEffect(() => {
    loadLeague("pro").then((d) => setTeams([d.teams.find((t) => t.id === "pro-phx") ?? d.teams[0], d.teams.find((t) => t.id === "pro-bos") ?? d.teams[1]]));
    first.current?.focus();
  }, []);

  // when a saved game shows up (after hydration), put the cursor on Resume
  const hasSaved = saves.length > 0;
  useEffect(() => {
    if (hasSaved) first.current?.focus();
  }, [hasSaved]);

  const resumeSave = (slot: SaveSlot, game: SuspendedGame) => {
    audio.unlock();
    setPending(resumePending(slot, game));
    router.push("/game/");
  };
  // the panel lists the saves: Resume game moves the cursor into that list
  const resume = () => document.querySelector<HTMLButtonElement>("[data-save-row]")?.focus();
  const rows: { slot: SaveSlot; group: SaveGroup; game: SuspendedGame | null }[] = [
    ...saves.filter((x) => x.slot === "auto"),
    ...(["play", "career"] as const).flatMap((group) =>
      SLOTS.map((slot) => ({ slot, group, game: saves.find((x) => x.slot === slot && x.group === group)?.game ?? null })),
    ),
  ];
  const discard = (slot: SaveSlot, group: SaveGroup) => {
    clearSuspended(slot, group);
    if (saves.length <= 1) {
      setFocused(ITEMS[0].id);
      first.current?.focus();
    }
    toast(`${slotLabel(slot, group)} deleted`);
  };

  const item = useMemo(() => items.find((i) => i.id === focused) ?? items[0], [focused, items]);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-navy">
      {/* the backdrop stays put while the menu scrolls; on wide screens only the menu column scrolls */}
      <div className="fixed inset-0" aria-hidden>
        {teams && <MenuTrailer home={teams[0]} away={teams[1]} />}
      </div>
      <div className="fixed inset-0 bg-gradient-to-r from-navy/90 via-navy/30 to-transparent" aria-hidden />
      <div className="relative flex min-h-dvh flex-col px-6 py-6 sm:px-12 lg:h-dvh">
        {IS_BETA && <BetaWarning className="lg:hidden" />}
        <div className="flex flex-1 flex-col justify-center gap-10 lg:min-h-0 lg:flex-row lg:items-center lg:justify-between">
          <nav
            aria-label="Main menu"
            className="flex flex-col lg:-ml-2 lg:max-h-full lg:overflow-y-auto lg:py-2 lg:pl-2 lg:pr-6 lg:[mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)] lg:[scrollbar-width:thin]"
          >
            <div className="relative mb-6 self-start">
              {/* the title over faint court paint: a three-point arc, the lane and the free-throw circle */}
              <svg
                className="absolute -inset-x-6 -inset-y-4 h-[calc(100%+2rem)] w-[calc(100%+3rem)]"
                viewBox="0 0 400 220"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path d="M10 210 A190 190 0 0 1 390 210" fill="none" stroke="var(--color-amber)" strokeOpacity="0.45" strokeWidth="3" />
                <rect x="140" y="80" width="120" height="130" fill="none" stroke="var(--color-amber)" strokeOpacity="0.35" strokeWidth="3" />
                <circle cx="200" cy="80" r="60" fill="none" stroke="var(--color-amber)" strokeOpacity="0.3" strokeWidth="3" strokeDasharray="10 8" />
              </svg>
              <h1 className="relative font-display text-[clamp(2.5rem,min(9vw,13vh),7.5rem)] font-black leading-[0.85] tracking-tight">
                <span className="text-net">Basketball</span>
                <br />
                <span className="text-amber">Legends</span>
              </h1>
            </div>
            <ul className="flex flex-col">
              {items.map((it, i) => (
                <li key={it.id}>
                  {it.soon ? (
                    <button
                      onClick={() => toast(`${it.label} arrives in a coming update. Quick Play is ready now.`)}
                      onFocus={() => setFocused(it.id)}
                      onMouseEnter={() => setFocused(it.id)}
                      className={menuCls(focused === it.id)}
                    >
                      {it.label}
                      <span className="ml-3 align-middle font-body text-sm font-semibold text-steel">Coming soon</span>
                    </button>
                  ) : it.id === "resume" ? (
                    <button
                      ref={i === 0 ? (first as React.RefObject<HTMLButtonElement>) : undefined}
                      onClick={resume}
                      onFocus={() => setFocused(it.id)}
                      onMouseEnter={() => setFocused(it.id)}
                      className={menuCls(focused === it.id)}
                    >
                      {it.label}
                    </button>
                  ) : (
                    <Link
                      ref={i === 0 ? (first as React.RefObject<HTMLAnchorElement>) : undefined}
                      href={it.href!}
                      onFocus={() => setFocused(it.id)}
                      onMouseEnter={() => setFocused(it.id)}
                      className={menuCls(focused === it.id)}
                    >
                      {it.label}
                      {it.soon && <span className="ml-3 align-middle font-body text-sm font-semibold text-steel">Coming soon</span>}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          {/* the right column stacks the beta card and the info panel, and the panel scrolls when they don't fit */}
          <div className="flex w-full max-w-md flex-col gap-4 lg:mr-8 lg:max-h-full lg:min-h-0">
            {IS_BETA && <BetaWarning className="hidden flex-none lg:block" />}
            <aside
              className="scrollbar-thin rounded-[var(--radius-panel)] bg-navy/80 p-6 ring-1 ring-line backdrop-blur lg:min-h-0 lg:overflow-y-auto"
              aria-live="polite"
            >
              <p className="font-display text-3xl font-black">{item.label}</p>
              <p className="mt-2 text-steel">{item.blurb}</p>
              <ul className="mt-4 flex flex-col gap-2 text-sm">
                {item.detail.map((d) => (
                  <li key={d} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-amber" />
                    {d}
                  </li>
                ))}
              </ul>
              {item.id === "resume" && (
                <ul className="mt-3 flex flex-col gap-2 p-0.5">
                  {rows.map(({ slot, group, game }) =>
                    !game ? (
                      <li key={`${group}-${slot}`} className="rounded-[var(--radius-chip)] px-3 py-2 ring-1 ring-line/60">
                        <span className="block text-xs font-semibold text-steel">{slotLabel(slot, group)}</span>
                        <span className="block text-sm text-steel">
                          Empty. Choose Save game in the pause menu to keep a {group === "career" ? "career " : ""}game here.
                        </span>
                      </li>
                    ) : (
                      <li key={`${group}-${slot}`} className="flex items-stretch gap-1">
                        <button
                          data-save-row
                          onClick={() => resumeSave(slot, game)}
                          onFocus={() => setFocused("resume")}
                          className="flex-1 rounded-[var(--radius-chip)] bg-deck-2 px-3 py-2 text-left ring-1 ring-line hover:ring-amber focus-visible:ring-amber"
                        >
                          <span className="block text-xs font-semibold text-amber">{slotLabel(slot, group)}</span>
                          <span className="block font-semibold leading-tight">
                            {game.summary.away} {game.summary.awayScore}, {game.summary.home} {game.summary.homeScore}
                          </span>
                          <span className="block text-xs text-steel">
                            {game.summary.mode ?? modeLabel(game.pending)} · {whereText(game)} · {savedWhen(game)}
                          </span>
                        </button>
                        <button
                          onClick={() => discard(slot, group)}
                          onFocus={() => setFocused("resume")}
                          aria-label={`Delete ${slot === "auto" ? "the autosave" : slotLabel(slot, group).toLowerCase()}`}
                          className="rounded-[var(--radius-chip)] px-2 text-steel hover:text-bad"
                        >
                          ✕
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </aside>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-4 text-sm text-steel">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <KeyHint action="up" device={device} />
              <KeyHint action="down" device={device} /> or arrows to move
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-line bg-deck px-1.5 py-0.5 text-[11px]">
                {device === "keyboard" ? "Enter" : device === "playstation" ? "✕" : "A"}
              </kbd>{" "}
              to select
            </span>
          </div>
          <nav aria-label="Site" className="flex gap-4">
            <Link href="/credits/" className="hover:text-net">
              Credits
            </Link>
            <Link href="/legal/terms/" className="hover:text-net">
              Terms
            </Link>
            <Link href="/legal/privacy/" className="hover:text-net">
              Privacy
            </Link>
            <a href="https://github.com/cksarge/Basketball-Legends" className="hover:text-net" rel="noreferrer">
              Source code
            </a>
            <Link href="/changelog/" className="hover:text-net">
              Version {process.env.APP_VERSION}
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** Shown only in the beta build (/beta/), which shares this browser's saves and settings with the live game. */
function BetaWarning({ className }: { className: string }) {
  return (
    <aside aria-label="Beta warning" className={`w-full rounded-[var(--radius-panel)] bg-navy/85 p-4 ring-2 ring-amber backdrop-blur ${className}`}>
      <p className="font-display text-2xl font-black text-amber">You&apos;re playing the beta</p>
      <p className="mt-1 text-sm text-net/90">
        Version {process.env.APP_VERSION} is an untested preview of the next update. It shares saves and settings with the main game in this browser, so a bug
        here could change or erase them, including a game you saved to resume.
      </p>
      <a href={`${SITE_URL}/`} className="mt-3 inline-block rounded-md bg-amber px-4 py-2 text-sm font-bold text-navy hover:brightness-110">
        Play the main game instead (recommended)
      </a>
    </aside>
  );
}

function menuCls(active: boolean) {
  return `group flex items-baseline py-1 text-left font-display text-[clamp(1.4rem,min(5vw,5.4vh),3rem)] font-extrabold leading-tight transition-colors ${active ? "text-amber" : "text-net/80 hover:text-net"}`;
}

const savedWhen = (g: SuspendedGame) => new Date(g.savedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
