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
import { clearSuspended, modeLabel, type SaveSlot, type SuspendedGame, useSaves, whereText } from "@/state/suspended";
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
    id: "park",
    label: "Play in the Park",
    href: "/park/",
    blurb: "Pickup ball at five outdoor courts.",
    detail: ["1-on-1 up to 5-on-5, half or full court", "Next game up, 21, HORSE and a 3-point contest", "Call your own fouls, check ball, win by 2"],
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
  const saves = useSaves();
  const items = useMemo<Item[]>(() => {
    if (!saves.length) return ITEMS;
    if (saves.length > 1)
      return [
        {
          id: "resume",
          label: "Saved games",
          blurb: `${saves.length} games waiting where you left them.`,
          detail: [],
        },
        ...ITEMS,
      ];
    const { slot, game } = saves[0];
    const g = game.summary;
    return [
      {
        id: "resume",
        label: "Resume game",
        blurb: `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}`,
        detail: [
          `${g.mode ?? modeLabel(game.pending)} · ${whereText(game)}`,
          `${slot === "auto" ? "Autosaved" : `Slot ${slot}, saved`} ${savedWhen(game)}`,
          "Picks up exactly where you left off",
        ],
      },
      ...ITEMS,
    ];
  }, [saves]);

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
  const hasSaved = saves.length > 0;
  useEffect(() => {
    if (hasSaved) first.current?.focus();
  }, [hasSaved]);

  const resumeSave = (slot: SaveSlot, game: SuspendedGame) => {
    audio.unlock();
    // a slot's game keeps saving back to that slot; the autosave remembers the slot its game came from
    setPending({ ...game.pending, resume: true, resumeFrom: slot, saveSlot: slot === "auto" ? game.pending.saveSlot : slot });
    router.push("/game/");
  };
  const resume = () => {
    if (saves.length === 1) resumeSave(saves[0].slot, saves[0].game);
    // several: the panel lists them
    else document.querySelector<HTMLButtonElement>("[data-save-row]")?.focus();
  };
  const discard = (slot: SaveSlot) => {
    clearSuspended(slot);
    if (saves.length <= 1) setFocused(ITEMS[0].id);
    toast(slot === "auto" ? "Autosave deleted" : `Slot ${slot} deleted`);
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
              <h1 className="relative font-display text-[clamp(3rem,9vw,7.5rem)] font-black leading-[0.85] tracking-tight">
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
            {item.id === "resume" && saves.length === 1 && (
              <button
                onClick={() => discard(saves[0].slot)}
                className="mt-4 text-sm font-semibold text-steel underline-offset-4 hover:text-bad hover:underline"
              >
                Discard this game
              </button>
            )}
            {item.id === "resume" && saves.length > 1 && (
              <ul className="mt-3 flex flex-col gap-2">
                {saves.map(({ slot, game }) => (
                  <li key={String(slot)} className="flex items-stretch gap-1">
                    <button
                      data-save-row
                      onClick={() => resumeSave(slot, game)}
                      onFocus={() => setFocused("resume")}
                      className="flex-1 rounded-[var(--radius-chip)] bg-deck-2 px-3 py-2 text-left ring-1 ring-line hover:ring-amber focus-visible:ring-amber"
                    >
                      <span className="block text-xs font-semibold text-amber">{slot === "auto" ? "Autosave" : `Slot ${slot}`}</span>
                      <span className="block font-semibold leading-tight">
                        {game.summary.away} {game.summary.awayScore}, {game.summary.home} {game.summary.homeScore}
                      </span>
                      <span className="block text-xs text-steel">
                        {game.summary.mode ?? modeLabel(game.pending)} · {whereText(game)} · {savedWhen(game)}
                      </span>
                    </button>
                    <button
                      onClick={() => discard(slot)}
                      onFocus={() => setFocused("resume")}
                      aria-label={`Delete ${slot === "auto" ? "the autosave" : `slot ${slot}`}`}
                      className="rounded-[var(--radius-chip)] px-2 text-steel hover:text-bad"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
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

const savedWhen = (g: SuspendedGame) => new Date(g.savedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
