"use client";
import { useEffect } from "react";
import { create } from "zustand";

export type InputDevice = "keyboard" | "xbox" | "playstation" | "gamepad";
export const useInputDevice = create<{ device: InputDevice; set: (d: InputDevice) => void }>((set) => ({
  device: "keyboard",
  set: (device) => set({ device }),
}));

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visibleFocusables(): HTMLElement[] {
  const scope = (document.querySelector("[data-nav-scope='modal']") as HTMLElement | null) ?? document.body;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest("[data-nav-skip]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  });
}

/** Spatial navigation: move focus to the nearest element in a direction. */
export function moveFocus(dir: "up" | "down" | "left" | "right") {
  const els = visibleFocusables();
  if (!els.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !els.includes(cur)) {
    els[0].focus();
    return;
  }
  // sliders/selects keep left/right for themselves
  if ((dir === "left" || dir === "right") && cur instanceof HTMLInputElement && cur.type === "range") {
    if (dir === "right") cur.stepUp();
    else cur.stepDown();
    cur.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2,
    ay = a.top + a.height / 2;
  let best: HTMLElement | null = null,
    bestScore = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2,
      by = b.top + b.height / 2;
    const dx = bx - ax,
      dy = by - ay;
    const along = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    const across = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    if (along <= 2) continue;
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/** Fires when the player presses back (Escape / gamepad B) in menus. */
export const BACK_EVENT = "bl:back";

export function MenuNavigator() {
  useEffect(() => {
    const inGame = () => document.body.dataset.ingame === "true";
    const onKey = (e: KeyboardEvent) => {
      useInputDevice.getState().set("keyboard");
      if (inGame()) return;
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement && (t.type === "text" || t.type === "search" || t.type === "number");
      if (typing && !["ArrowUp", "ArrowDown", "Escape"].includes(e.key)) return;
      const map: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      if (map[e.key] && !(t instanceof HTMLSelectElement)) {
        e.preventDefault();
        moveFocus(map[e.key]);
      } else if (e.key === "Escape") {
        window.dispatchEvent(new CustomEvent(BACK_EVENT));
      }
    };
    window.addEventListener("keydown", onKey);

    // gamepad polling for menus
    let raf = 0;
    const prev: Record<string, boolean> = {};
    let repeatAt = 0;
    const poll = (now: number) => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      const pad = [...pads].find((p) => p && p.connected);
      if (!pad) return;
      const id = pad.id.toLowerCase();
      const anyPressed = pad.buttons.some((b) => b.pressed) || pad.axes.some((v) => Math.abs(v) > 0.5);
      if (anyPressed)
        useInputDevice.getState().set(/054c|playstation|dualsense|dualshock/.test(id) ? "playstation" : /xbox|xinput|045e/.test(id) ? "xbox" : "gamepad");
      if (inGame()) return;
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      const dirs = {
        up: btn(12) || pad.axes[1] < -0.55,
        down: btn(13) || pad.axes[1] > 0.55,
        left: btn(14) || pad.axes[0] < -0.55,
        right: btn(15) || pad.axes[0] > 0.55,
      };
      for (const [d, on] of Object.entries(dirs)) {
        if (on && (!prev[d] || now > repeatAt)) {
          moveFocus(d as "up");
          repeatAt = now + (prev[d] ? 110 : 380);
        }
        prev[d] = on;
      }
      const a = btn(0),
        b = btn(1);
      if (a && !prev.a) (document.activeElement as HTMLElement | null)?.click();
      if (b && !prev.b) window.dispatchEvent(new CustomEvent(BACK_EVENT));
      prev.a = a;
      prev.b = b;
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
