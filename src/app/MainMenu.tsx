"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Team } from "@/engine/types";
import { loadLeague, rosterFor } from "@/data/leagues";
import { useMatchStore } from "@/state/matchStore";
import { useSettings } from "@/state/settings";
import { audio } from "@/audio/engine";
import { TeamLogo } from "@/ui/TeamLogo";
import { useInputDevice } from "@/ui/MenuNavigator";
import { KeyHint } from "@/ui/KeyHint";
import { toast } from "@/ui/Toaster";
import { clearSuspended, useSuspended } from "@/state/suspended";
import { IS_BETA, SITE_URL } from "@/lib/site";

const MenuBackdrop = dynamic(() => import("@/game3d/MenuBackdrop"), { ssr: false });

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
    id: "playnow",
    label: "Play now",
    blurb: "Jump straight into a game with a random matchup.",
    detail: ["Picks two teams from the same league", "Uses your saved difficulty and quarter length", "Keyboard or controller, no setup"],
  },
  {
    id: "quick",
    label: "Quick Play",
    href: "/play/",
    blurb: "Any two teams from any league, your rules.",
    detail: [
      "1,405 teams: pro, college and every Arizona high school",
      "Jerseys, arena, difficulty, quarter length",
      "Up to four local players, or sim instantly",
    ],
  },
  {
    id: "career",
    label: "Career",
    href: "/career/",
    blurb: "One player, from freshman year to the Hall of Fame.",
    detail: [
      "Build your player and pick your Arizona high school",
      "Tryouts, call-ups and a run at the state title",
      "Recruiting, college, the draft and the pros are coming in this beta",
    ],
  },
  {
    id: "franchise",
    label: "Franchise",
    href: "/franchise/",
    soon: true,
    blurb: "Coach and run a program for as many seasons as you like.",
    detail: ["Rotations, playbooks, trades, recruiting, the draft", "Play or sim every game", "Arrives in a later update"],
  },
  {
    id: "tutorial",
    label: "Tutorial",
    blurb: "Learn the controls step by step on an open floor.",
    detail: ["Moving, sprinting and dribble moves", "Shot timing, layups, threes and passing", "Uses your own key and button bindings"],
  },
  {
    id: "practice",
    label: "Practice",
    href: "/play/?practice=1",
    blurb: "Free shootaround in an empty gym.",
    detail: ["Work on shot timing with the meter", "Try every dribble move and finish", "No clock, no defense"],
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
function primaryDevice(device: string): string {
  if (device === "keyboard" || typeof navigator === "undefined") return "keyboard";
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
  return pad ? `pad${pad.index}` : "keyboard";
}

export function MainMenu() {
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [focused, setFocused] = useState(ITEMS[0].id);
  const device = useInputDevice((s) => s.device);
  const setPending = useMatchStore((s) => s.setPending);
  const quarter = useSettings((s) => s.gameplay.quarterMinutes);
  const first = useRef<HTMLButtonElement>(null);
  const suspended = useSuspended();
  const items = useMemo<Item[]>(() => {
    if (!suspended) return ITEMS;
    const g = suspended.summary;
    const when = new Date(suspended.savedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
    return [
      {
        id: "resume",
        label: "Resume game",
        blurb: `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}`,
        detail: [`${g.period}, ${g.clock} left`, `Saved ${when}`, "Picks up exactly where you left off"],
      },
      ...ITEMS,
    ];
  }, [suspended]);

  useEffect(() => {
    loadLeague("pro").then((d) => {
      let idx = 0;
      try {
        idx = Number(sessionStorage.getItem("bl-menu-team") ?? Math.floor(Math.random() * d.teams.length));
        sessionStorage.setItem("bl-menu-team", String(idx));
      } catch {
        idx = 23;
      }
      setTeam(d.teams[idx % d.teams.length]);
    });
    first.current?.focus();
  }, []);

  // when a saved game shows up (after hydration), put the cursor on Resume
  const hasSaved = suspended !== null;
  useEffect(() => {
    if (hasSaved) first.current?.focus();
  }, [hasSaved]);

  const resume = () => {
    if (!suspended) return;
    audio.unlock();
    setPending({ ...suspended.pending, resume: true });
    router.push("/game/");
  };
  const discard = () => {
    clearSuspended();
    setFocused(ITEMS[0].id);
    toast("Saved game discarded");
  };

  const playNow = async () => {
    audio.unlock();
    const d = await loadLeague("pro");
    const pick = [...d.teams].sort(() => Math.random() - 0.5);
    const [home, away] = [pick[0], pick[1]];
    setPending({
      mode: "quick",
      league: "pro",
      arena: "pro",
      home: { team: home, roster: rosterFor(home), uniform: "home", controllers: [primaryDevice(device)] },
      away: { team: away, roster: rosterFor(away), uniform: "away", controllers: [] },
      quarterMinutes: quarter,
      returnTo: "/",
      seed: Math.floor(Math.random() * 1e6),
    });
    router.push("/game/");
  };

  // with a saved game, the panel starts on Resume until something else is focused
  const tutorial = async () => {
    audio.unlock();
    const d = await loadLeague("pro");
    const home = team ?? d.teams[0];
    const away = d.teams.find((t) => t.id !== home.id) ?? d.teams[1];
    setPending({
      mode: "practice",
      league: "pro",
      arena: "pro",
      home: { team: home, roster: rosterFor(home), uniform: "home", controllers: [primaryDevice(device)] },
      away: { team: away, roster: rosterFor(away), uniform: "away", controllers: [] },
      quarterMinutes: quarter,
      returnTo: "/",
      seed: Math.floor(Math.random() * 1e6),
      practice: true,
      tutorial: true,
    });
    router.push("/game/");
  };

  const item = useMemo(() => items.find((i) => i.id === focused) ?? items[0], [focused, items]);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-navy">
      {/* the backdrop stays put while the menu scrolls; on wide screens only the menu column scrolls */}
      <div className="fixed inset-0" aria-hidden>
        {team && <MenuBackdrop team={team} kind="pro" />}
      </div>
      <div className="fixed inset-0 bg-gradient-to-r from-navy via-navy/75 to-transparent" aria-hidden />
      <div className="relative flex min-h-dvh flex-col px-6 py-6 sm:px-12 lg:h-dvh">
        <header className="flex items-center gap-4">
          {team && <TeamLogo team={team} size={44} />}
          <p className="font-display text-xl font-bold text-steel">Tonight at {team?.arena.name ?? "the arena"}</p>
        </header>
        {IS_BETA && <BetaWarning />}
        <div className="flex flex-1 flex-col justify-center gap-10 lg:min-h-0 lg:flex-row lg:items-center lg:justify-between">
          <nav
            aria-label="Main menu"
            className="flex flex-col lg:-ml-2 lg:max-h-full lg:overflow-y-auto lg:py-2 lg:pl-2 lg:pr-6 lg:[mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)] lg:[scrollbar-width:thin]"
          >
            <h1 className="mb-6 font-display text-[clamp(3rem,9vw,7.5rem)] font-black leading-[0.85] tracking-tight">
              Basketball
              <br />
              Legends
            </h1>
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
                      ref={i === 0 ? first : undefined}
                      onClick={resume}
                      onFocus={() => setFocused(it.id)}
                      onMouseEnter={() => setFocused(it.id)}
                      className={menuCls(focused === it.id)}
                    >
                      {it.label}
                    </button>
                  ) : it.id === "tutorial" ? (
                    <button onClick={tutorial} onFocus={() => setFocused(it.id)} onMouseEnter={() => setFocused(it.id)} className={menuCls(focused === it.id)}>
                      {it.label}
                    </button>
                  ) : it.id === "playnow" ? (
                    <button
                      ref={i === 0 ? first : undefined}
                      onClick={playNow}
                      onFocus={() => setFocused(it.id)}
                      onMouseEnter={() => setFocused(it.id)}
                      className={menuCls(focused === it.id)}
                    >
                      {it.label}
                    </button>
                  ) : (
                    <Link href={it.href!} onFocus={() => setFocused(it.id)} onMouseEnter={() => setFocused(it.id)} className={menuCls(focused === it.id)}>
                      {it.label}
                      {it.soon && <span className="ml-3 align-middle font-body text-sm font-semibold text-steel">Coming soon</span>}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <aside className="w-full max-w-sm rounded-[var(--radius-panel)] bg-navy/80 p-6 ring-1 ring-line backdrop-blur lg:mr-8" aria-live="polite">
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
              <button onClick={discard} className="mt-4 text-sm font-semibold text-steel underline-offset-4 hover:text-bad hover:underline">
                Discard this game
              </button>
            )}
          </aside>
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
function BetaWarning() {
  return (
    <aside
      aria-label="Beta warning"
      className="mt-4 w-full rounded-[var(--radius-panel)] bg-navy/85 p-4 ring-2 ring-amber backdrop-blur lg:absolute lg:right-12 lg:top-6 lg:mt-0 lg:max-w-md"
    >
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
  return `group flex items-baseline py-1 text-left font-display text-[clamp(1.6rem,5vw,3rem)] font-extrabold leading-tight transition-colors ${active ? "text-amber" : "text-net/80 hover:text-net"}`;
}
