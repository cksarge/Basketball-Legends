// Starts a sim in the worker, or on this thread if the browser can't run one.
import { proxy, wrap } from "comlink";
import type { IsoDate } from "@/career/types";
import type { Team } from "@/engine/types";
import { runSim, type SimRange } from "./simRun";
import type { SimWorker } from "./worker";

export interface SimHandle {
  done: Promise<void>;
  cancel(): void;
}

function onThisThread(r: SimRange, teams: Team[], onDay: (date: IsoDate) => void): SimHandle {
  let stop = false;
  return {
    done: runSim(r, teams, onDay, () => stop).then(() => undefined),
    cancel: () => {
      stop = true;
    },
  };
}

export function startSim(r: SimRange, teams: Team[], onDay: (date: IsoDate) => void): SimHandle {
  let worker: Worker;
  try {
    if (typeof Worker === "undefined") throw new Error("no workers");
    worker = new Worker(new URL("./worker.ts", import.meta.url));
  } catch {
    return onThisThread(r, teams, onDay);
  }
  const api = wrap<SimWorker>(worker);
  let started = false;
  let fallback: SimHandle | null = null;
  const done = new Promise<void>((resolve, reject) => {
    // a worker that can't load never answers, so its error event is the only sign
    worker.addEventListener("error", () => {
      worker.terminate();
      if (started) return reject(new Error("The sim stopped unexpectedly."));
      fallback = onThisThread(r, teams, onDay);
      fallback.done.then(resolve, reject);
    });
    api
      .run(
        r,
        teams,
        proxy((date: IsoDate) => {
          started = true;
          onDay(date);
        }),
      )
      .then(resolve, reject);
  }).finally(() => worker.terminate());
  return {
    done,
    cancel: () => {
      if (fallback) fallback.cancel();
      else void api.cancel();
    },
  };
}
