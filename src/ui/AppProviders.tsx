"use client";
import { useEffect } from "react";
import { detectPreset, useSettings } from "@/state/settings";
import { MenuNavigator } from "./MenuNavigator";
import { toast, Toaster } from "./Toaster";
import { asset } from "@/lib/site";

/** Global client providers: applies settings to <html>, menu navigation, toasts. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const uiScale = useSettings((s) => s.accessibility.uiScale);
  const reducedMotion = useSettings((s) => s.accessibility.reducedMotion);
  const colorblind = useSettings((s) => s.accessibility.colorblind);
  const autoDetected = useSettings((s) => s.graphics.autoDetected);
  const applyPreset = useSettings((s) => s.applyPreset);
  const set = useSettings((s) => s.set);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale));
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
    document.documentElement.dataset.colorblind = colorblind;
  }, [uiScale, reducedMotion, colorblind]);

  useEffect(() => {
    if (!autoDetected) {
      applyPreset(detectPreset());
      set("graphics", { autoDetected: true });
    }
  }, [autoDetected, applyPreset, set]);

  // offline support (production builds only, so dev never serves stale code)
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const firstInstall = !navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register(asset("/sw.js"))
      .then((reg) => {
        if (!firstInstall) return;
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "activated") toast("Basketball Legends now works offline", "good");
          });
        });
      })
      .catch(() => {
        /* offline support is optional */
      });
  }, []);

  return (
    <>
      <MenuNavigator />
      {children}
      <Toaster />
    </>
  );
}
