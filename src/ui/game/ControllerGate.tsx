"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PendingMatch } from "@/state/matchStore";
import { Button } from "../kit";
import { isTouchOnly, withController } from "./touchOnly";
import { GameView } from "./GameView";

const none = () => () => {};
const touchOnly = () => isTouchOnly(window.matchMedia("(pointer: coarse)").matches, window.matchMedia("(any-pointer: fine)").matches);
const firstPad = () => [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected)?.index ?? null;

/** Holds a game on touch-only devices until a controller connects, or a real keyboard is used. */
export function ControllerGate({ pending }: { pending: PendingMatch }) {
  const router = useRouter();
  const blocked = useSyncExternalStore(none, touchOnly, () => false);
  const [pad, setPad] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    if (!blocked) return;
    const scan = () => setPad(firstPad());
    const onKey = () => setKeyboard(true);
    const h = setInterval(scan, 500);
    window.addEventListener("gamepadconnected", scan);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(h);
      window.removeEventListener("gamepadconnected", scan);
      window.removeEventListener("keydown", onKey);
    };
  }, [blocked]);

  if (!blocked || keyboard) return <GameView pending={pending} />;
  if (pad !== null) return <GameView pending={withController(pending, pad)} />;
  return (
    <div className="grid min-h-dvh place-items-center bg-navy p-6 text-center" role="alertdialog" aria-label="Controller needed">
      <div className="flex max-w-md flex-col items-center gap-4">
        <h1 className="font-display text-4xl font-black">Connect a controller</h1>
        <p className="text-net/90">This game does not support touch controls. Please connect a controller to continue.</p>
        <p className="text-sm text-steel">Already connected? Press any button on it. You can still use menus and sim games by touch.</p>
        <Button variant="secondary" onClick={() => router.push(pending.returnTo)}>
          Go back
        </Button>
      </div>
    </div>
  );
}
