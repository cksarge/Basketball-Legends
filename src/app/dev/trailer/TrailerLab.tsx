"use client";
// Holds the menu trailer on a chosen moment (?t=seconds), for checking how each shot looks.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Team } from "@/engine/types";
import { loadLeague } from "@/data/leagues";

const MenuTrailer = dynamic(() => import("@/game3d/MenuTrailer"), { ssr: false });

export function TrailerLab() {
  const [teams, setTeams] = useState<[Team, Team] | null>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setT(Number(new URLSearchParams(window.location.search).get("t") ?? 0));
    loadLeague("pro").then((d) => setTeams([d.teams.find((x) => x.id === "pro-phx")!, d.teams.find((x) => x.id === "pro-bos")!]));
  }, []);
  return <div className="fixed inset-0 bg-black">{teams && <MenuTrailer home={teams[0]} away={teams[1]} startAt={t} frozen />}</div>;
}
