import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { archetypesFor, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Team } from "@/engine/types";
import hs from "@/data/generated/hs.json";
import { DEFAULT_SETTINGS, createCareer, defaultBody } from "../create";
import { EXPORT_KIND, deleteCareer, exportCareer, importCareer, listCareers, loadCareer, openCareerDb, saveCareer } from "../storage";
import { CAREER_VERSION } from "../types";

const team = (hs.teams as unknown as Team[])[0];
let n = 0;
const make = (first = "Ana") =>
  createCareer(
    {
      firstName: first,
      lastName: "Cruz",
      pos: "PG",
      archetype: archetypesFor("PG")[0],
      body: defaultBody("PG"),
      appearance: randomAppearance(new Rng(2)),
      jersey: 3,
      hometown: "Phoenix, AZ",
      schoolId: team.id,
      allocation: {},
      settings: DEFAULT_SETTINGS,
      startYear: 2026,
    },
    1000 + n++,
  );

beforeEach(() => {
  openCareerDb(`test-${Math.random()}`);
});

describe("career storage", () => {
  it("saves, lists newest first, loads and deletes", async () => {
    const a = await saveCareer(make("Ana"), team, 1000);
    const b = await saveCareer(make("Bo"), team, 2000);
    const list = await listCareers();
    expect(list.map((s) => s.name)).toEqual(["Bo Cruz", "Ana Cruz"]);
    expect(list[0].teamName).toBe(`${team.name} ${team.nickname}`);
    expect((await loadCareer(a.id))?.player.firstName).toBe("Ana");
    await deleteCareer(b.id);
    expect((await listCareers()).map((s) => s.id)).toEqual([a.id]);
    expect(await loadCareer("missing")).toBeNull();
  });

  it("saving again updates the same career", async () => {
    const c = await saveCareer(make(), team, 1000);
    await saveCareer({ ...c, date: "2026-11-02" }, team, 3000);
    const list = await listCareers();
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe("2026-11-02");
    expect(list[0].updatedAt).toBe(3000);
  });

  it("exports and imports a career, giving it a new id if the original still exists", async () => {
    const c = await saveCareer(make(), team);
    const text = exportCareer(c);
    expect(JSON.parse(text).kind).toBe(EXPORT_KIND);
    const copy = await importCareer(text, () => team);
    expect(copy.id).not.toBe(c.id);
    expect(copy.player.firstName).toBe(c.player.firstName);
    await deleteCareer(c.id);
    await deleteCareer(copy.id);
    const same = await importCareer(text, () => team);
    expect(same.id).toBe(c.id);
  });

  it("rejects files that aren't careers or come from a newer version", async () => {
    await expect(importCareer("not json", () => team)).rejects.toThrow("isn't a career save");
    await expect(importCareer(JSON.stringify({ kind: "other" }), () => team)).rejects.toThrow("isn't a career save");
    const future = { kind: EXPORT_KIND, career: { ...make(), version: CAREER_VERSION + 1 } };
    await expect(importCareer(JSON.stringify(future), () => team)).rejects.toThrow("newer version");
  });
});
