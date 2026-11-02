// The sim's Web Worker, so long sims leave the page responsive.
import { expose } from "comlink";
import type { IsoDate } from "@/career/types";
import type { Team } from "@/engine/types";
import { runSim, type SimRange } from "./simRun";

let stop = false;

const api = {
  async run(r: SimRange, teams: Team[], onDay: (date: IsoDate) => void) {
    stop = false;
    await runSim(r, teams, onDay, () => stop);
  },
  cancel() {
    stop = true;
  },
};
export type SimWorker = typeof api;

expose(api);
