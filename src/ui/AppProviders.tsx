"use client";
import { useEffect } from "react";
import { detectPreset, useSettings } from "@/state/settings";
import { MenuNavigator } from "./MenuNavigator";
import { Toaster } from "./Toaster";

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

  return (
    <>
      <MenuNavigator />
      {children}
      <Toaster />
    </>
  );
}
