import { expect, test, type Page } from "@playwright/test";

// Paths are relative to baseURL so the same tests run against the live build (/) and the beta build (/beta/, with E2E_BASE=/beta).
const BASE = process.env.E2E_BASE ?? "";

/**
 * Game-flow tests run on the Low preset with intros skipped: headless Chrome renders in
 * software, so full graphics would run the simulation in slow motion.
 */
async function lowGraphics(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("bl-settings")) return;
    localStorage.setItem(
      "bl-settings",
      JSON.stringify({
        version: 1,
        state: {
          graphics: {
            preset: "low",
            autoDetected: true,
            resolutionScale: 0.5,
            shadows: false,
            bloom: false,
            ambientOcclusion: false,
            antialias: false,
            crowdDensity: 0.05,
            fpsCap: 0,
            showFps: false,
          },
          presentation: { skipIntros: true, replays: false },
        },
      }),
    );
  });
}

/** The game clock (score bug) has started running down. */
async function clockRuns(page: Page) {
  const clock = page.locator(".led").nth(1);
  await expect(clock).toBeVisible({ timeout: 60_000 });
  const start = await clock.textContent();
  await expect.poll(async () => clock.textContent(), { timeout: 60_000 }).not.toBe(start);
}

/** Fail on page errors and console errors (ignoring known third-party deprecation noise). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|THREE\.Clock|WebGL|GPU stall|swiftshader/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const PAGES: [string, RegExp][] = [
  ["./", /Basketball\s*Legends/],
  ["play/", /Quick Play/],
  ["settings/", /Settings/],
  ["how-to-play/", /How to play/],
  ["credits/", /Credits/],
  ["legal/terms/", /Terms of Service/],
  ["legal/privacy/", /Privacy Policy/],
  ["changelog/", /Changelog/],
  ["career/", /Road to Legend/],
  ["career/new/", /Create a player/],
  ["park/", /Play in the Park/],
];

for (const [path, heading] of PAGES) {
  test(`${path} renders without errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.locator("h1").first()).toHaveText(heading);
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
  });
}

test("the main menu version links to the changelog", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: /^Version \d+\.\d+\.\d+/ }).click();
  await expect(page).toHaveURL(/\/changelog\/$/);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(/^v\d+\.\d+\.\d+/);
});

test("create a career, then find it on the career screen after a reload", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("career/new/");
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill("Rookie");
  await page.getByRole("button", { name: "2. Position" }).click();
  await page.getByRole("radio", { name: "PG" }).click();
  await page.getByRole("button", { name: "5. Skills" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await expect(page.getByText(/^0$/).first()).toBeVisible();
  await page.getByRole("button", { name: "6. Start" }).click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Test Rookie");
  await expect(page.getByText("Welcome to the program")).toBeVisible();
  // tryouts (skipping the drills), then simulate the first game
  await page.getByRole("button", { name: "Go to tryouts" }).click();
  await page.getByRole("button", { name: /Skip the drills/ }).click();
  await expect(page.getByText(/Tryout results:/).first()).toBeVisible();
  await page.getByRole("button", { name: "On to the season" }).click();
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByText("Recent games")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByRole("cell", { name: "Test Rookie" })).toBeVisible();
  await page.getByRole("tab", { name: "Stats" }).click();
  // freshmen can't be contacted yet: recruiting opens after sophomore year
  await page.getByRole("tab", { name: "Recruiting" }).click();
  await expect(page.getByRole("heading", { name: /Recruiting opens/ })).toBeVisible();
  await expect(page.getByText("Your recruitment")).toBeVisible();
  await page.getByRole("tab", { name: "Player" }).click();
  await expect(page.getByText("Ratings")).toBeVisible();
  await page.goto("career/");
  await page.reload();
  await expect(page.getByText("Test Rookie")).toBeVisible();
  await expect(page.getByText("PG ·", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a career game saved to a Legend slot resumes from the hub, and simming it clears the save @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  await lowGraphics(page);
  await page.goto("career/new/");
  await page.getByLabel("First name").fill("Slot");
  await page.getByLabel("Last name").fill("Saver");
  await page.getByRole("button", { name: "2. Position" }).click();
  await page.getByRole("radio", { name: "PG" }).click();
  await page.getByRole("button", { name: "5. Skills" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await page.getByRole("button", { name: "6. Start" }).click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  const hub = page.url();
  await page.getByRole("button", { name: "Go to tryouts" }).click();
  await page.getByRole("button", { name: /Skip the drills/ }).click();
  await page.getByRole("button", { name: "On to the season" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  // a freshman usually starts on the bench
  await page.getByRole("button", { name: "Watch from the bench" }).click({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save game" }).click();
  await page.getByRole("button", { name: /^1 Empty/ }).click();
  await expect(page.getByText("Saved to slot 1:")).toBeVisible();
  await page.getByRole("button", { name: "Back to your career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  // it sits in the Career slots, not the Quick Play ones
  const slot = () => page.evaluate(() => [localStorage.getItem("bl-career-save-1") !== null, localStorage.getItem("bl-save-1") !== null]);
  expect(await slot()).toEqual([true, false]);
  await page.goto("./");
  await page.getByRole("button", { name: "Resume game" }).click();
  await expect(page.getByRole("button", { name: /Legend slot 1.*Road to Legend/ })).toBeVisible();
  // the hub resumes it from the slot
  await page.goto(hub);
  await page.getByRole("button", { name: /Resume game \(/ }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Quit game" }).click();
  await expect(page.getByText(/stays saved in slot 1/)).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Quit" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  expect(await slot()).toEqual([true, false]);
  // simming that game from the hub means the save can't resume anymore
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect.poll(slot, { timeout: 60_000 }).toEqual([false, false]);
});

/** Creates a career and jumps its save to a graduated senior headed to college. */
async function graduate(page: Page, first: string) {
  await page.goto("career/new/");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill("Star");
  await page.getByRole("button", { name: "2. Position" }).click();
  await page.getByRole("radio", { name: "PG" }).click();
  await page.getByRole("button", { name: "5. Skills" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await page.getByRole("button", { name: "6. Start" }).click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByText("Road to Legend").first()).toBeVisible();
  await expect(page.getByText("Local Hero", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to tryouts" }).click();
  await page.getByRole("button", { name: /Skip the drills/ }).click();
  await page.getByRole("button", { name: "On to the season" }).click();
  // jump the save to a graduated senior headed to a college
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("bl-career");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("careers", "readwrite").objectStore("careers");
          const all = store.getAll();
          all.onsuccess = () => {
            const row = all.result.find((r) => r.data.player.firstName === name);
            const d = row.data;
            const s = d.hs.seasons.at(-1);
            Object.assign(s, {
              grade: 12,
              games: [],
              wrapped: true,
              grades: { fall: 3, spring: 3 },
              ranking: { date: d.date, stars: 4, national: 80, state: 2, score: 66, exposure: 2 },
            });
            d.date = `${s.year + 1}-05-28`;
            d.recruiting = { offers: [], visitsUsed: 0, visitsAllowed: 5, college: { teamId: "col-albany", walkOn: false, date: `${s.year + 1}-05-01` } };
            d.log.push({ date: d.date, text: "Graduated from high school.", kind: "milestone" });
            store.put(row).onsuccess = () => resolve();
          };
        };
      }),
    first,
  );
  await page.reload();
}

/** Changes the open career's save, then reloads the hub. */
async function patchCareer(page: Page, first: string, patch: string) {
  await page.evaluate(
    ([name, code]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("bl-career");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("careers", "readwrite").objectStore("careers");
          const all = store.getAll();
          all.onsuccess = () => {
            const row = all.result.find((r) => r.data.player.firstName === name);
            new Function("d", code)(row.data);
            store.put(row).onsuccess = () => resolve();
          };
        };
      }),
    [first, patch],
  );
  await page.reload();
}

test("a graduate moves on campus: college hub, a played game, sims, NIL and the Road to Legend card @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Campus");
  await page.getByRole("button", { name: "Move in on campus" }).click();
  await expect(page.getByRole("button", { name: "Sim game", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Recruiting" })).toHaveCount(0);
  await expect(page.getByText("Coach trust")).toBeVisible();
  // NIL
  await page.getByRole("button", { name: "Sign" }).first().click();
  await expect(page.getByText(/Earned so far: \$[1-9]/)).toBeVisible();
  // a real college game loads in 3D
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  const bench = page.getByRole("button", { name: "Watch from the bench" });
  await expect(page.locator(".led").nth(1).or(bench).first()).toBeVisible({ timeout: 60_000 });
  if (await bench.isVisible()) await bench.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Save game" })).toBeVisible();
  // finishing it records the result on the hub
  await page.getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByText("Recent games")).toBeVisible({ timeout: 30_000 });
  // sims run through the real engine and feed every tab
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.locator("li", { hasText: " pts, " }).nth(1)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByRole("cell", { name: "Campus Star" })).toBeVisible();
  await page.getByRole("tab", { name: "Stats" }).click();
  await expect(page.getByText("College career")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the road to the draft: agent, combine, workouts, interviews and draft night @gpu", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Draft");
  await page.getByRole("button", { name: "Move in on campus" }).click();
  await expect(page.getByText("Coach trust")).toBeVisible();
  await patchCareer(page, "Draft", 'd.college.declared = { date: d.date, stock: { pick: 12, label: "Lottery pick", score: 82.8 } };');
  await page.getByRole("button", { name: "Start the road to the draft" }).click();
  await page.getByRole("button", { name: "Sign with Dana" }).click();
  await page.getByRole("button", { name: "Go to the combine" }).click();
  await page.getByRole("button", { name: /Sit out the drills/ }).click();
  await expect(page.getByText(/Combine: .* vertical/).first()).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(page.getByRole("heading", { name: `Team workouts (${i} of 3)` })).toBeVisible();
    await page.getByRole("list", { name: "Teams asking for a workout" }).getByRole("button").first().click();
  }
  for (let i = 0; i < 3; i++) {
    await expect(page.getByRole("heading", { name: `GM interviews (${i + 1} of 3)` })).toBeVisible();
    await page
      .getByRole("button", { name: /worst|outwork|learn everything|walked through/i })
      .first()
      .click();
  }
  await page.getByRole("button", { name: "Head to the draft" }).click();
  await page.getByRole("button", { name: /Skip to/ }).click();
  await page.getByRole("button", { name: /Continue|Leave the draft/ }).click();
  await expect(page.getByText(/Drafted|Went undrafted/).first()).toBeVisible();
  // a rookie season: training camp, a real game, then every tab
  await page.getByRole("list", { name: "Summer focus" }).getByRole("button", { name: "Shooting" }).click();
  await expect(page.getByText("Team chemistry")).toBeVisible();
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sim game", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  const bench = page.getByRole("button", { name: "Watch from the bench" });
  await expect(page.locator(".led").nth(1).or(bench).first()).toBeVisible({ timeout: 60_000 });
  if (await bench.isVisible()) await bench.click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
  await page.waitForURL(/career\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/).nth(1)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByRole("cell", { name: "Draft Star" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
  await page.getByRole("tab", { name: "Stats" }).click();
  await expect(page.getByText("Pro career")).toBeVisible();
  expect(errors).toEqual([]);
});

test("retirement: an Icon sees their odds, then the Legend verdict and the Hall of Legends @gpu", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Final");
  await page.getByRole("button", { name: "Move in on campus" }).click();
  await expect(page.getByText("Coach trust")).toBeVisible();
  await patchCareer(
    page,
    "Final",
    `const base = d.college.seasons.at(-1);
     const season = (i) => ({ year: 2040 + i, teamId: "pro-bos", status: "standard", role: "starter", trust: 80, chemistry: 60, roster: base.roster, games: [], stats: { ...base.stats, gp: 82, gs: 82, pts: 2500, ast: 500, dreb: 400 }, playoffStats: { ...base.stats }, awards: ["Most Valuable Player", "All-League First Team", "League champion", "All-Star"], series: [], finish: "Won the championship", wrapped: true });
     d.stage = "pro"; d.player.age = 34; d.player.teamId = "pro-bos"; d.player.contract = { salary: 30000000, years: 2 }; d.date = "2055-06-28";
     d.pro = { preDraft: { year: 2040, agent: "family", workouts: [1, 2, 3], interviews: [0, 0, 0], stockDelta: 0, combine: { scores: [], bonus: 0, verticalIn: 36, laneSec: 11, threesMade: 12 } }, draft: { year: 2040, picks: [], trades: [], teamId: "pro-bos", seen: true }, status: "standard", confidence: 0, teamFirst: 0, earnings: 400000000, seasons: Array.from({ length: 14 }, (_, i) => season(i)), endorsements: [] };`,
  );
  await expect(page.getByText("Icon", { exact: true })).toBeVisible();
  await expect(page.getByText(/% chance will be a Legend at retirement/)).toBeVisible();
  await page.getByRole("tab", { name: "Legends" }).click();
  await expect(page.getByRole("heading", { name: "Hall of Legends" })).toBeVisible();
  await expect(page.getByText("Marcus Delacroix")).toBeVisible();
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Retire from basketball" }).click();
  await page.getByRole("list", { name: "Who you thank first" }).getByRole("button", { name: "My family" }).click();
  await expect(page.getByText("Basketball Legend", { exact: true })).toBeVisible();
  await expect(page.getByText("Elected to the Hall of Fame.").first()).toBeVisible();
  await expect(page.getByText(/retired number/).first()).toBeVisible();
  // the verdict survives a reload once the save has landed
  const stage = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          indexedDB.open("bl-career").onsuccess = (e) => {
            const all = (e.target as IDBOpenDBRequest).result.transaction("careers").objectStore("careers").getAll();
            all.onsuccess = () => resolve(all.result.find((r) => r.data.player.firstName === "Final").data.stage);
          };
        }),
    );
  await expect.poll(stage).toBe("retired");
  await page.reload();
  await expect(page.getByText("Basketball Legend", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the beta warning shows only in the beta build", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("complementary", { name: "Beta warning" })).toHaveCount(BASE === "/beta" ? 1 : 0);
});

test("the beta warning never overlaps the menu panel, with every save slot full", async ({ page }) => {
  test.skip(BASE !== "/beta", "the warning only shows in the beta build");
  await page.addInitScript(() => {
    const save = (mode: string) =>
      JSON.stringify({
        v: 1,
        savedAt: 1,
        match: "x",
        pending: { mode },
        summary: { home: "Boston", away: "Phoenix", homeScore: 16, awayScore: 20, period: "Q2", clock: "6:00" },
      });
    localStorage.setItem("bl-suspended", save("quick"));
    for (const n of [1, 2, 3]) {
      localStorage.setItem(`bl-save-${n}`, save("quick"));
      localStorage.setItem(`bl-career-save-${n}`, save("career"));
    }
  });
  for (const [width, height] of [
    [1024, 640],
    [1280, 760],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("./");
    await page.getByRole("button", { name: "Resume game" }).click();
    const card = await page.getByRole("complementary", { name: "Beta warning" }).boundingBox();
    const panel = await page.locator("aside[aria-live]").boundingBox();
    expect(card && panel && card.y + card.height <= panel.y).toBe(true);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(height);
  }
});

test("unknown pages show the 404", async ({ page }) => {
  const res = await page.goto("no-such-page/");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Airball")).toBeVisible();
});

test("site files are published", async ({ request }) => {
  for (const f of ["robots.txt", "sitemap.xml", "favicon.ico", "apple-touch-icon.png", "manifest.webmanifest", "sw.js", "models/player.glb"]) {
    const r = await request.get(f);
    expect(r.status(), f).toBe(200);
  }
  const robots = await (await request.get("robots.txt")).text();
  expect(robots).toContain("Sitemap:");
  expect(robots).toContain("Disallow: /dev/");
  expect(robots).toContain("Disallow: /beta/");
  const sitemap = await (await request.get("sitemap.xml")).text();
  for (const p of ["/play/", "/how-to-play/", "/legal/privacy/", "/changelog/"]) expect(sitemap).toContain(p);
});

test("quick play starts a game that loads and plays @gpu", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await page.goto("play/");
  await expect(page.getByRole("heading", { name: "Coaching" })).toBeVisible();
  await page.getByRole("button", { name: "Play game" }).click();
  await page.waitForURL("**/game/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  // the loading screen clears and the clock runs
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  // pause menu opens with the key and its tabs work
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
  await page.getByRole("button", { name: "Box score" }).click();
  await page.getByRole("button", { name: "Tactics" }).click();
  await expect(page.getByText("Changes take effect on the next possession")).toBeVisible();
  expect(errors).toEqual([]);
});

test("save slots: a quick game and a park game saved side by side, then resumed @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  await lowGraphics(page);
  await page.goto("play/");
  await page.getByRole("button", { name: "Play game" }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save game" }).click();
  await page.getByRole("button", { name: /^1 Empty/ }).click();
  await expect(page.getByText("Saved to slot 1:")).toBeVisible();
  await page.getByRole("button", { name: "Quit to main menu" }).click();
  await page.waitForURL((u) => new URL(u).pathname === `${BASE}/`);
  // Resume game lists the slots: slot 1 has the game, 2 and 3 are empty
  await page.getByRole("button", { name: "Resume game" }).click();
  await expect(page.getByRole("button", { name: /Slot 1.*Quick Play/ })).toBeFocused();
  await expect(page.getByText("Slot 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Legend slot 1", { exact: true })).toBeVisible();
  // a park game goes in slot 2 without touching slot 1
  await page.goto("park/");
  await page.getByRole("radio", { name: "1v1" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText(/Game to 15/)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save game" }).click();
  await expect(page.getByRole("button", { name: /^1 .*Quick Play/ })).toBeVisible();
  await page.getByRole("button", { name: /^2 Empty/ }).click();
  await page.getByRole("button", { name: "Quit to main menu" }).click();
  await page.waitForURL((u) => new URL(u).pathname === `${BASE}/`);
  await page.getByRole("button", { name: "Resume game" }).click();
  await expect(page.getByRole("button", { name: /Slot 1.*Quick Play/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Slot 2.*Play in the Park/ })).toBeVisible();
  await page.getByRole("button", { name: /Slot 1.*Quick Play/ }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible({ timeout: 60_000 });
});

test("settings persist across reloads", async ({ page }) => {
  await page.goto("settings/");
  await page
    .getByRole("tab", { name: "Presentation" })
    .or(page.getByRole("button", { name: "Presentation" }))
    .first()
    .click();
  const toggle = page.getByLabel("Big-play banners");
  const was = await toggle.isChecked();
  await toggle.click();
  await page.reload();
  await page
    .getByRole("tab", { name: "Presentation" })
    .or(page.getByRole("button", { name: "Presentation" }))
    .first()
    .click();
  expect(await page.getByLabel("Big-play banners").isChecked()).toBe(!was);
});

test("the tutorial starts and advances @gpu", async ({ page }) => {
  test.setTimeout(150_000);
  await lowGraphics(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Tutorial" }).click();
  await page.waitForURL("**/game/");
  const panel = page.getByRole("region", { name: "Tutorial" });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText("Step 1 of 10");
  // walk back and forth until the first step checks off
  await expect
    .poll(
      async () => {
        for (const k of ["KeyD", "KeyW", "KeyA", "KeyS"]) {
          await page.keyboard.down(k);
          await page.waitForTimeout(700);
          await page.keyboard.up(k);
        }
        return panel.textContent();
      },
      { timeout: 90_000, intervals: [0] },
    )
    .toContain("Step 2 of 10");
});

test("play in the park: the setup remembers your choices, and a 1-on-1 game starts @gpu", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await page.goto("park/");
  await page.getByRole("button", { name: /Ironside Cage/ }).click();
  await page.getByRole("radio", { name: "1v1" }).click();
  await page.getByRole("radio", { name: "2s and 3s" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /Ironside Cage/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: "1v1" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("The other side")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText(/Game to 15 · win by 2 · 2s and 3s · half court/)).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("play in the park: the 3-point contest shows its clock and racks @gpu", async ({ page }) => {
  test.setTimeout(150_000);
  await lowGraphics(page);
  await page.goto("park/");
  await page.getByRole("radio", { name: "3-point contest" }).click();
  await expect(page.getByText("Rivals", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Gold balls are worth 2", { exact: false }).or(page.getByText("Get ready…"))).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("L corner")).toBeVisible();
});
