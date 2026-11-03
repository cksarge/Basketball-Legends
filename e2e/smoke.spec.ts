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
  ["franchise/", /Franchise/],
  ["franchise/new/", /New franchise/],
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

test("create a franchise, reload the hub and find it on the franchise screen", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByLabel("Search teams").fill("Phoenix");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Phoenix");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Phoenix");
  await page.goto("franchise/");
  await expect(page.getByText("Phoenix", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("sim a franchise season: results, leaders, a reload, Stop, and a champion", async ({ page }) => {
  test.setTimeout(360_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sim game", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/).first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/).first()).toBeVisible();
  // Stop during a long sim, then run the season out
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Sim the season" }).click();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Sim the season" })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Sim the season" }).click();
  await expect(page.getByText(/won the championship/)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Most Valuable Player")).toBeVisible();
  await page.getByRole("tab", { name: "Leaders" }).click();
  await expect(page.getByRole("button", { name: "PPG" })).toBeVisible();
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
  await page.getByRole("tab", { name: "Playoffs" }).click();
  await expect(page.getByText("The Finals").first()).toBeVisible();
  await page.getByRole("tab", { name: "Roster" }).click();
  await expect(page.getByRole("button", { name: "OVR" })).toBeVisible();
  // the offseason, through to next season's opening day with a rookie on the roster
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Go to the offseason" }).click();
  await page.getByRole("button", { name: "Continue to Player progress" }).click();
  await expect(page.getByRole("heading", { name: "Your players" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Draft lottery" }).click();
  await expect(page.getByRole("heading", { name: "Lottery results" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue to Contracts" })).toBeDisabled();
  await page.getByRole("button", { name: "Sim to my pick" }).click();
  await expect(page.getByText("You're on the clock.")).toBeVisible();
  await page.getByRole("button", { name: "Draft", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Draft results" })).toBeVisible();
  await page.getByRole("button", { name: "Sim the draft" }).click();
  await page.getByRole("button", { name: "Continue to Contracts" }).click();
  const staff = page.getByRole("button", { name: "Let your staff decide" });
  if (await staff.isVisible()) await staff.click();
  await page.getByRole("button", { name: "Continue to Free agency" }).click();
  await page.getByRole("button", { name: "Continue to Training camp" }).click();
  await page.getByRole("button", { name: "Let your staff set the roster" }).click();
  await page.getByRole("button", { name: /^Start the \d{4} season$/ }).click();
  await expect(page.getByRole("tab", { name: "Offseason" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Next game" })).toBeVisible();
  await page.getByRole("tab", { name: "Roster" }).click();
  await expect(page.getByRole("cell", { name: /^\d{2}-\d{2}$/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Next game" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("run a franchise offseason: option, re-sign, bid, release, two-way", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("button", { name: "Sim the season" }).click();
  await expect(page.getByText(/won the championship/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Go to the offseason" }).click();
  await page.getByRole("button", { name: "Continue to Player progress" }).click();
  await page.getByRole("button", { name: "Continue to Draft lottery" }).click();
  await page.getByRole("button", { name: "Continue to Draft", exact: true }).click();
  await page.getByRole("button", { name: "Sim the draft" }).click();
  await page.getByRole("button", { name: "Continue to Contracts" }).click();
  await expect(page.getByRole("heading", { name: "Team options" })).toBeVisible();
  const staff = page.getByRole("button", { name: "Let your staff decide" });
  if (await staff.isVisible()) await staff.click();
  await expect(page.getByText("You have no team options to decide.")).toBeVisible();
  const resign = page.getByRole("button", { name: "Re-sign" }).first();
  if (await resign.isVisible()) {
    await resign.click();
    await page.getByRole("button", { name: "Make offer" }).click();
    // either he signed and the dialog closed, or it says why not
    await expect(
      page
        .getByRole("dialog")
        .getByRole("status")
        .or(page.getByText(/Re-signed /)),
    ).toBeVisible();
    // his ask can top what veteran rights allow, and then the dialog stays open and says so
    await page
      .getByRole("button", { name: "Close", exact: true })
      .click({ timeout: 1500 })
      .catch(() => undefined);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Continue to Free agency" }).click();
  await expect(page.getByRole("heading", { name: "Moratorium" })).toBeVisible();
  // the most expensive player is out of reach, and the dialog says why
  await page.getByRole("button", { name: "Bid", exact: true }).first().click();
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByRole("status").filter({ hasText: /most this team can pay/ })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("button", { name: "Bid", exact: true }).first().click();
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Start round one" }).click();
  for (const n of [2, 3, 4, 5]) await page.getByRole("button", { name: `Run round ${n}` }).click();
  await expect(page.getByRole("heading", { name: "Open market" })).toBeVisible();
  await page.getByRole("button", { name: "Two-way" }).first().click();
  await page.getByRole("button", { name: "Continue to Training camp" }).click();
  await page.getByRole("button", { name: "Let your staff set the roster" }).click();
  await page.getByRole("button", { name: /^Start the \d{4} season$/ }).click();
  await page.getByRole("tab", { name: "Roster" }).click();
  await expect(page.getByRole("heading", { name: "Cap sheet" })).toBeVisible();
  await expect(page.getByText("2W").first()).toBeVisible();
  await page.getByRole("button", { name: "Release" }).first().click();
  await page.getByRole("tab", { name: "Free agents" }).click();
  await expect(page.getByRole("heading", { name: "On waivers" })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Free agents" }).click();
  await expect(page.getByRole("heading", { name: "On waivers" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("make a franchise trade, undo it and make it again", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Trades" }).click();
  const theirs = page.locator("fieldset").nth(1);
  const name = (await theirs.locator("li span").nth(14).innerText()).split(",")[0];
  // one of their players for nothing is refused
  await theirs.getByRole("checkbox").nth(14).check();
  await expect(page.getByRole("list", { name: "Problems with this deal" })).toBeVisible();
  await page.getByRole("button", { name: "Find a deal" }).click();
  await page.getByRole("button", { name: "Load deal" }).first().click();
  await page.getByRole("button", { name: "Propose trade" }).click();
  await expect(page.getByText("Trade done.")).toBeVisible();
  await page.getByRole("tab", { name: "Roster" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Trades" }).click();
  await theirs.getByRole("checkbox").nth(14).check();
  await page.getByRole("button", { name: "Find a deal" }).click();
  await page.getByRole("button", { name: "Load deal" }).first().click();
  await page.getByRole("button", { name: "Propose trade" }).click();
  await expect(page.getByText("Trade done.")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Roster" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trade block" }).first().click();
  await page.getByRole("tab", { name: "Trades" }).click();
  await expect(page.getByRole("heading", { name: "Trade block" })).toBeVisible();
  await page.getByRole("button", { name: "Ask around" }).click();
  await expect(page.getByRole("button", { name: "Accept" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("run the club: set prices and budgets, read the owner's review", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Club" }).click();
  await page.getByLabel("Ticket price").fill("150");
  await page.getByLabel("Ticket price").blur();
  await expect(page.getByText("Your owner wants")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Club" }).click();
  await expect(page.getByLabel("Ticket price")).toHaveValue("150");
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Sim the season" }).click();
  await expect(page.getByText(/won the championship/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Go to the offseason" }).click();
  await expect(page.getByRole("heading", { name: "The owner's review" })).toBeVisible();
  await page.getByRole("tab", { name: "Club" }).click();
  await expect(page.getByText("Last season")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a fired coach takes a new job and the hub follows", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  // an owner out of patience, with goals nobody can meet
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("bl-franchise");
        open.onerror = fail;
        open.onsuccess = () => {
          const store = open.result.transaction("saves", "readwrite").objectStore("saves");
          const all = store.getAll();
          all.onsuccess = () => {
            const row = all.result[0];
            row.data.job.security = 1;
            row.data.job.seasons = 3;
            row.data.job.goals = [
              { key: "winning", target: 82 },
              { key: "profit", target: 1e12 },
              { key: "development", target: 9999 },
            ];
            store.put(row).onsuccess = () => {
              open.result.close();
              done();
            };
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Sim the season" }).click();
  await expect(page.getByText(/won the championship/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Go to the offseason" }).click();
  await expect(page.getByRole("heading", { name: "You've been fired" })).toBeVisible();
  const title = await page.getByRole("heading", { level: 1 }).innerText();
  await expect(page.getByRole("button", { name: /^Continue to/ })).toBeDisabled();
  await page
    .getByRole("button", { name: /^Take the job/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(title);
  const next = await page.getByRole("heading", { level: 1 }).innerText();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(next);
  await page.goto("franchise/");
  await expect(page.getByText(next).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the league remembers: news, rankings, history, records and the Hall", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("button", { name: "Sim the season" }).click();
  await expect(page.getByText(/won the championship/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Go to the offseason" }).click();
  await page.getByRole("button", { name: "Continue to Player progress" }).click();
  await page.getByRole("button", { name: "Continue to Draft lottery" }).click();
  await page.getByRole("button", { name: "Continue to Draft", exact: true }).click();
  await page.getByRole("button", { name: "Sim the draft" }).click();
  await page.getByRole("button", { name: "Continue to Contracts" }).click();
  const staff = page.getByRole("button", { name: "Let your staff decide" });
  if (await staff.isVisible()) await staff.click();
  await page.getByRole("button", { name: "Continue to Free agency" }).click();
  await page.getByRole("button", { name: "Continue to Training camp" }).click();
  await page.getByRole("button", { name: "Let your staff set the roster" }).click();
  await page.getByRole("button", { name: /^Start the \d{4} season$/ }).click();
  await expect(page.getByRole("tab", { name: "Offseason" })).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem("bl-legends", JSON.stringify([{ careerId: "c1", player: { id: "legend", firstName: "Road", lastName: "Hero", pos: "SG", age: 38 } }]));
  });
  await page.reload();
  await page.getByRole("tab", { name: "League" }).click();
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  await expect(page.getByText(/won the championship/).first()).toBeVisible();
  await page.getByRole("radio", { name: "Power rankings" }).click();
  await expect(page.getByRole("table", { name: "Power rankings" }).getByRole("row")).toHaveCount(31);
  await page.getByRole("radio", { name: "History" }).click();
  await expect(page.getByText(/2026-27: .* won the title/)).toBeVisible();
  await page.getByRole("radio", { name: "Records" }).click();
  await expect(page.getByText("Most points in a season")).toBeVisible();
  await page.getByRole("radio", { name: "Hall of Fame" }).click();
  await expect(page.getByRole("heading", { name: "Road to Legend" })).toBeVisible();
  await expect(page.getByText("Road Hero")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "League" }).click();
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("change settings, turn on auto-manage and compare two players", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByText("League settings").click();
  await page.getByRole("combobox", { name: "Games per season" }).selectOption("41");
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("combobox", { name: "Games per season" })).toHaveValue("41");
  await page.getByRole("combobox", { name: "Games per season" }).selectOption("58");
  await expect(page.getByText("Starts next season").first()).toBeVisible();
  for (const toggle of await page.getByRole("switch").all()) if ((await toggle.getAttribute("aria-checked")) === "false") await toggle.click();
  await page.reload();
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("combobox", { name: "Games per season" })).toHaveValue("58");
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Sim the season" }).click();
  await expect(page.getByText(/won the championship/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Go to the offseason" }).click();
  await page.getByRole("button", { name: "Sim the offseason" }).click();
  await expect(page.getByRole("tab", { name: "Offseason" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Roster" }).click();
  await page.getByLabel("Filter Roster").fill("zzzz");
  await expect(page.getByRole("table", { name: "Roster" }).getByRole("row")).toHaveCount(1);
  await page.getByLabel("Filter Roster").fill("");
  await page.getByRole("tab", { name: "League" }).click();
  await page.getByRole("radio", { name: "Compare" }).click();
  await page.getByRole("combobox", { name: "First player" }).selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "Second player" }).selectOption({ index: 2 });
  await expect(page.getByRole("table", { name: "Player comparison" }).getByText("Overall")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a franchise game saves to a Franchise slot, resumes from the hub and records its result @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  await lowGraphics(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save game" }).click();
  await page.getByRole("button", { name: /^1 Empty/ }).click();
  await expect(page.getByText("Saved to slot 1:")).toBeVisible();
  await page.getByRole("button", { name: "Back to your franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  expect(await page.evaluate(() => [localStorage.getItem("bl-franchise-save-1") !== null, localStorage.getItem("bl-save-1") !== null])).toEqual([true, false]);
  await page.goto("./");
  await page.getByRole("button", { name: "Resume game" }).click();
  // a slot in use sits above every empty slot, and each kind of game has its three
  const slots = page.locator("aside ul").last().locator("li");
  await expect(slots).toHaveCount(9);
  await expect(slots.first()).toContainText("Franchise slot 1");
  await expect(slots.nth(1)).toContainText("Slot 1");
  await expect(slots.last()).toContainText("Franchise slot 3");
  await page.goBack();
  await page.getByRole("button", { name: "Resume game" }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim to end" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({ timeout: 120_000 });
  // reloading the final screen doesn't lose the game or start it over
  await page.reload();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/)).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("bl-franchise-save-1"))).toBeNull();
  // and reopening the finished game leads back to the hub, with one result
  await page.goto("game/");
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/)).toHaveCount(1);
});

test("pick a playbook, then call a play in the game @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  await lowGraphics(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Coaching" }).click();
  await page.getByRole("radio", { name: "Playbook" }).click();
  await page.getByLabel("System").selectOption("motion");
  await expect(page.getByRole("checkbox", { name: /Floppy/ })).toBeChecked();
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Plays" }).click();
  await page.getByRole("button", { name: /Floppy/ }).click();
  await expect(page.getByText("Floppy called")).toBeVisible();
});

test("play only the 4th quarter of a franchise game @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  await lowGraphics(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("button", { name: "Play the 4th quarter" }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(page.getByText(/^[WL]$/)).toHaveCount(1);
  await page.getByRole("tab", { name: "Home" }).click();
  await expect(page.getByText(/After three quarters/)).toBeHidden();
});

test("Save and quit stays in the game when the save fails @gpu", async ({ page }) => {
  test.setTimeout(240_000);
  await lowGraphics(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Save and quit" }).click();
  await expect(page.getByText(/Couldn't save/)).toBeVisible();
  expect(page.url()).toContain("/game/");
});

test("coaching a franchise: lineup, practice and staff stick, and the lineup starts games", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("franchise/new/");
  await page.getByRole("button", { name: /Phoenix/ }).click();
  await page.getByRole("button", { name: "Start franchise" }).click();
  await page.waitForURL(/franchise\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Coaching" }).click();
  await page.getByRole("switch", { name: "Auto rotation" }).click();
  const slot = page.getByLabel("Starting PG");
  await expect(slot).toBeVisible();
  const bench = (await slot.locator("option").allTextContents()).at(-1)!;
  await slot.selectOption({ label: bench });
  await page.getByRole("radio", { name: "Practice" }).click();
  await page.getByLabel("Team focus").selectOption("shooting");
  await page.getByRole("radio", { name: "Staff" }).click();
  await page.getByRole("button", { name: /^Hire/ }).nth(6).click();
  await expect(page.getByText("Current:").nth(1)).not.toContainText("Nobody");
  await page.reload();
  await page.getByRole("tab", { name: "Coaching" }).click();
  await expect(page.getByLabel("Starting PG").locator("option:checked")).toHaveText(bench);
  await page.getByRole("radio", { name: "Practice" }).click();
  await expect(page.getByLabel("Team focus")).toHaveValue("shooting");
  await page.getByRole("radio", { name: "Staff" }).click();
  await expect(page.getByText("Current:").nth(1)).not.toContainText("Nobody");
  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sim game", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Roster" }).click();
  const name = bench.split(" (")[0];
  await expect(
    page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("cell")
      .nth(7),
  ).toHaveText("1");
  expect(errors).toEqual([]);
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

test("the story: a press conference, the phone, the social feed and your reputation @gpu", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Story");
  await page.getByRole("button", { name: "Move in on campus" }).click();
  await expect(page.getByText("Coach trust")).toBeVisible();
  // a preseason interview waits at the top of the hub
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByRole("list", { name: "Your answer" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("list", { name: "Your answer" }).getByRole("button").first().click();
  await expect(page.getByRole("status").filter({ hasText: /\w/ }).first()).toBeVisible();
  await page.getByRole("tab", { name: /Phone/ }).click();
  await page.getByRole("list", { name: "Conversations" }).getByRole("button").first().click();
  await expect(
    page
      .getByRole("list", { name: /Texts with/ })
      .getByRole("listitem")
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Thanks." }).click();
  await expect(page.getByRole("list", { name: /Texts with/ }).getByText("Thanks.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your reputation" })).toBeVisible();
  await page
    .getByRole("radio", { name: "Social" })
    .or(page.getByRole("button", { name: "Social" }))
    .first()
    .click();
  await page.getByRole("tab", { name: "Legends" }).click();
  await expect(page.getByRole("heading", { name: "Your rival" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the park in a career: a run earns reputation, and a Legend plays on in the park @gpu", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await page.goto("career/new/");
  await page.getByLabel("First name").fill("Street");
  await page.getByLabel("Last name").fill("Baller");
  await page.getByRole("button", { name: "2. Position" }).click();
  await page.getByRole("radio", { name: "PG" }).click();
  await page.getByRole("button", { name: "5. Skills" }).click();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await page.getByRole("button", { name: "6. Start" }).click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Park" }).click();
  await expect(page.getByRole("heading", { name: "Your name at the parks" })).toBeVisible();
  await expect(page.getByText("3 runs left this off-season")).toBeVisible();
  // the tough parks start closed
  await expect(page.getByRole("button", { name: "Run at Copper Flats Courts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run at Rooftop/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sim a run at Copper Flats Courts" }).click();
  await expect(page.getByText("2 runs left this off-season")).toBeVisible();
  // a real run in 3D comes back to the hub
  await page.getByRole("button", { name: "Run at Copper Flats Courts", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim to end" }).click();
  await page
    .getByRole("button", { name: /Continue|Back|Done/ })
    .first()
    .click({ timeout: 120_000 });
  await page.waitForURL(/career\/hub\/\?id=/);
  await page.getByRole("tab", { name: "Park" }).click();
  await expect(page.getByText("1 run left this off-season")).toBeVisible({ timeout: 30_000 });
  // a Legend's name goes on the hometown courts
  await page.evaluate(() =>
    localStorage.setItem(
      "bl-legends",
      JSON.stringify([{ careerId: "x", player: { id: "legend-x", firstName: "Old", lastName: "Great", pos: "PG", heightIn: 75, age: 38, ratings: {} } }]),
    ),
  );
  await page.goto("park/");
  await expect(page.getByText("Old Great Courts")).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Draft night" })).toBeVisible();
  await expect(page.getByText("ON THE CLOCK")).toBeVisible();
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
  await expect(page.getByText("Marcus Delacroix").first()).toBeVisible();
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

/** Fills in the creator up to its last step. */
async function creator(page: Page, first: string) {
  await page.goto("career/new/");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill("Tester");
  await page.getByRole("button", { name: "Assign me a school" }).click();
  await page.getByRole("button", { name: "2. Position" }).click();
  await page.getByRole("radio", { name: "PG" }).click();
  await page.getByRole("button", { name: "5. Skills" }).click();
  await page.getByRole("button", { name: /Sharpshooter/ }).click();
  await page.getByRole("button", { name: /Lockdown/ }).click();
  await expect(page.getByRole("button", { name: /Slasher/ })).toBeDisabled();
  await page.getByRole("button", { name: "Auto-fill" }).click();
  await page.getByRole("button", { name: "6. Start" }).click();
}

test("start in college from the creator, at the program you pick", async ({ page }) => {
  const errors = watchErrors(page);
  await creator(page, "Coll");
  await page
    .getByRole("radio", { name: "College" })
    .or(page.getByRole("button", { name: "College", exact: true }))
    .first()
    .click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByText("Coach trust")).toBeVisible();
  await expect(page.getByText("Freshman ·").first()).toBeVisible();
  await page.getByRole("tab", { name: "Player" }).click();
  await expect(page.getByText("Sharpshooter").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("start in the pros: through the draft, or straight onto a team", async ({ page }) => {
  const errors = watchErrors(page);
  await creator(page, "Draftee");
  await page
    .getByRole("radio", { name: "The pros" })
    .or(page.getByRole("button", { name: "The pros", exact: true }))
    .first()
    .click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByRole("heading", { name: "Choose your agent" })).toBeVisible();
  await creator(page, "Vet");
  await page
    .getByRole("radio", { name: "The pros" })
    .or(page.getByRole("button", { name: "The pros", exact: true }))
    .first()
    .click();
  await page.getByLabel("Go through the draft").click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByRole("list", { name: "Summer focus" })).toBeVisible();
  await page.getByRole("button", { name: "Run practice drills first" }).click();
  await page.getByRole("button", { name: "Skip the session" }).click();
  await page.getByRole("list", { name: "Summer focus" }).getByRole("button", { name: "Defense" }).click();
  await expect(page.getByText("Team chemistry")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the hub: calendar, stat chart, goals, scrapbook and sim to next event @gpu", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Hubby");
  await page.getByRole("button", { name: "Move in on campus" }).click();
  await expect(page.getByText("Coach trust")).toBeVisible();
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByRole("list", { name: "Your answer" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Walk past|Let it go/ }).click();
  await page.getByRole("button", { name: "Sim 5" }).click();
  await expect(page.getByRole("button", { name: "Sim to next event" })).toBeEnabled({ timeout: 90_000 });
  for (let i = 0; i < 4; i++) {
    const skip = page.getByRole("button", { name: /Walk past|Let it go/ });
    if (await skip.isVisible()) await skip.click();
  }
  await page.getByRole("button", { name: "Sim to next event" }).click();
  await expect(
    page
      .getByText("Simulating")
      .or(page.getByRole("list", { name: "Your answer" }))
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: "Stop after this game" })
    .click({ timeout: 10_000 })
    .catch(() => undefined);
  await page.getByRole("tab", { name: "Schedule" }).click();
  await page
    .getByRole("radio", { name: "Calendar" })
    .or(page.getByRole("button", { name: "Calendar", exact: true }))
    .first()
    .click();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("tab", { name: "Stats" }).click();
  await expect(page.getByRole("heading", { name: "Stat history" })).toBeVisible();
  await page
    .getByRole("radio", { name: "This season" })
    .or(page.getByRole("button", { name: "This season", exact: true }))
    .first()
    .click();
  await expect(page.getByRole("img", { name: /This season/ })).toBeVisible();
  await page.getByRole("tab", { name: "Legends" }).click();
  await expect(page.getByRole("heading", { name: "Goals and milestones" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your scrapbook" })).toBeVisible();
  await expect(page.getByText(/Legend points \(/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("your rival's call-out, from the park tab to the head-to-head @gpu", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  // seeds vary, so try until one of them calls you out this summer
  let open = false;
  for (let i = 0; i < 12 && !open; i++) {
    await creator(page, `Caller${i}`);
    await page.getByRole("button", { name: "Start career" }).click();
    await page.waitForURL(/career\/hub\/\?id=/);
    await page.getByRole("tab", { name: "Park" }).click();
    await page.getByRole("button", { name: "Sim a run at Copper Flats Courts" }).click();
    await expect(page.getByText("2 runs left this off-season")).toBeVisible();
    open = await page.getByRole("heading", { name: "You've been called out" }).isVisible();
  }
  expect(open).toBe(true);
  await page.getByRole("button", { name: "Sim it" }).click();
  await expect(page.getByRole("heading", { name: "You've been called out" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Legends" }).click();
  await expect(page.getByText(/[01]-[01] head to head/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a Legend lives on: Quick Play, the park picker and their kid's career @gpu", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Heir");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        indexedDB.open("bl-career").onsuccess = (e) => {
          const all = (e.target as IDBOpenDBRequest).result.transaction("careers").objectStore("careers").getAll();
          all.onsuccess = () => {
            const p = all.result[0].data.player;
            localStorage.setItem(
              "bl-legends",
              JSON.stringify([{ careerId: "old", player: { ...p, id: "legend-old", firstName: "Grand", lastName: "Master", age: 28 } }]),
            );
            resolve();
          };
        };
      }),
  );
  // the park picker
  await page.goto("park/");
  await expect(page.getByText("Grand Master Courts")).toBeVisible();
  await page
    .getByRole("button", { name: /Change/ })
    .first()
    .click();
  await page
    .getByRole("radio", { name: "Your Legends" })
    .or(page.getByRole("button", { name: "Your Legends" }))
    .first()
    .click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Grand Master/ })).toBeVisible();
  await page.keyboard.press("Escape");
  // Quick Play
  await page.goto("play/");
  await page.getByLabel("Add a Legend").selectOption({ label: "Grand Master" });
  await page.getByRole("button", { name: "Play game" }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  // their kid
  await page.goto("career/");
  await page.getByRole("button", { name: "Start their kid's career" }).click();
  await expect(page.getByLabel("Last name")).toHaveValue("Master");
  await page.getByLabel("First name").fill("Junior");
  await page.getByRole("button", { name: "6. Start" }).click();
  await expect(page.getByText(/child of Basketball Legend Grand Master/)).toBeVisible();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Junior Master");
  expect(errors).toEqual([]);
});

test("park options: fouls can be turned off, and your career players can be picked", async ({ page }) => {
  const errors = watchErrors(page);
  await creator(page, "Picker");
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await page.goto("park/");
  await expect(page.getByLabel("Call your own fouls")).toBeChecked();
  await page.getByLabel("Call your own fouls").click();
  await page
    .getByRole("button", { name: /Change/ })
    .first()
    .click();
  await page
    .getByRole("radio", { name: "Your players" })
    .or(page.getByRole("button", { name: "Your players" }))
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Picker Tester/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("standalone parks: two are open, and street reputation from a career opens the rest", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("park/");
  await expect(page.getByRole("button", { name: /Copper Flats Courts/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Maple Street Park/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Boardwalk Courts/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Ironside Cage/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Rooftop on Ninth/ })).toBeDisabled();
  await page.evaluate(() => localStorage.setItem("bl-street-rep", "60"));
  await page.reload();
  await expect(page.getByRole("button", { name: /Boardwalk Courts/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Ironside Cage/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Rooftop on Ninth/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test.describe("on a touch-only phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

  test("menus work, a game waits for a controller, and connecting one starts it @gpu", async ({ page }) => {
    await lowGraphics(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __pad: boolean };
      w.__pad = false;
      navigator.getGamepads = () => (w.__pad ? ([{ index: 0, connected: true, buttons: [], axes: [0, 0, 0, 0], id: "Test pad" }] as unknown as Gamepad[]) : []);
    });
    await page.goto("play/");
    await page.getByRole("button", { name: "Play game" }).click();
    await page.waitForURL("**/game/");
    const gate = page.getByRole("alertdialog", { name: "Controller needed" });
    await expect(gate).toContainText("does not support touch controls");
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "Go back" }).click();
    await page.waitForURL("**/play/");
    await page.getByRole("button", { name: "Play game" }).click();
    await expect(gate).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __pad: boolean }).__pad = true;
    });
    await expect(gate).toBeHidden({ timeout: 5_000 });
    await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  });

  test("a real keyboard gets you in too", async ({ page }) => {
    await page.goto("play/");
    await page.getByRole("button", { name: "Play game" }).click();
    const gate = page.getByRole("alertdialog", { name: "Controller needed" });
    await expect(gate).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(gate).toBeHidden();
  });
});

test("the changelog links across to the other version of the game", async ({ page }) => {
  await page.goto("changelog/");
  const link = page.getByRole("link", { name: BASE === "/beta" ? "Play the main version by clicking here." : "Play the beta version by clicking here." });
  await expect(link).toHaveAttribute("href", BASE === "/beta" ? "https://legends.carterscoding.com/" : "https://legends.carterscoding.com/beta/");
});

/** Jumps a new career to a pro season already in progress. */
const PRO_SAVE = (extra: string) => `
  const base = d.college.seasons.at(-1);
  d.stage = "pro"; d.player.age = 27; d.player.teamId = "pro-bos"; d.date = "2040-06-28";
  d.player.ratings.three = 92; d.player.ratings.dunk = 60;
  d.pro = { preDraft: { year: 2039, agent: "family", workouts: [1, 2, 3], interviews: [0, 0, 0], stockDelta: 0, combine: { scores: [], bonus: 0, verticalIn: 36, laneSec: 11, threesMade: 12 } }, draft: { year: 2039, picks: [], trades: [], teamId: "pro-bos", seen: true }, status: "standard", confidence: 0, teamFirst: 0, earnings: 1000000, endorsements: [], seasons: [{ year: 2039, teamId: "pro-bos", status: "standard", role: "starter", trust: 70, chemistry: 60, roster: base.roster, games: [], stats: { ...base.stats, gp: 82, gs: 82, pts: 2000, ast: 400, dreb: 300 }, playoffStats: { ...base.stats }, awards: [], series: [], finish: "Lost in the East Semifinals", wrapped: true }] };
  ${extra}`;

test("the pros, on screen: free agency, a season, a trade request and All-Star weekend @gpu", async ({ page }) => {
  test.setTimeout(200_000);
  const errors = watchErrors(page);
  await lowGraphics(page);
  await graduate(page, "Vet");
  await page.getByRole("button", { name: "Move in on campus" }).click();
  await expect(page.getByText("Coach trust")).toBeVisible();
  // an expired contract: offers, a negotiation, then signing
  await patchCareer(
    page,
    "Vet",
    PRO_SAVE(`d.player.contract = { salary: 5000000, years: 0 };
      d.pro.offers = [{ teamId: "pro-bos", salary: 9000000, years: 2, role: "starter", promise: false }, { teamId: "pro-mia", salary: 8000000, years: 3, role: "starter", promise: true }];`),
  );
  await expect(page.getByRole("heading", { name: "Free agency" })).toBeVisible();
  await page.getByRole("list", { name: "Contract offers" }).getByRole("button", { name: "Ask for 8% more" }).first().click();
  await expect(page.getByText(/agreed to the raise|walked away/).first()).toBeVisible();
  await page.getByRole("list", { name: "Contract offers" }).getByRole("button", { name: "Sign" }).last().click();
  await expect(page.getByRole("list", { name: "Summer focus" })).toBeVisible();
  await page.getByRole("list", { name: "Summer focus" }).getByRole("button", { name: "Shooting" }).click();
  await expect(page.getByText("Team chemistry")).toBeVisible();
  // a trade request is on the record
  await page.getByRole("button", { name: "Request a trade" }).click();
  await expect(page.getByText(/You've asked for a trade/)).toBeVisible();
  // All-Star weekend: the contest in 3D, then the game
  await patchCareer(
    page,
    "Vet",
    `const s = d.pro.seasons.at(-1);
     d.date = (s.year + 1) + "-02-10"; s.allStar = { decided: true, selected: true, threeInvited: true };
     for (const g of s.games) if (g.homeId === s.teamId || g.awayId === s.teamId) g.result = g.result ?? { home: 100, away: 90, played: false, overtimes: 0, dnp: true };
     s.games.push({ id: "allstar-" + s.year, date: (s.year + 1) + "-02-15", level: "pro", homeId: "pro-allstar-east", awayId: "pro-allstar-west", kind: "allstar", neutral: true, label: "All-Star Game" });`,
  );
  await page.getByRole("button", { name: "Play the contest" }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Quit game" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Quit" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await page.getByRole("button", { name: "Sim the contest" }).click();
  await expect(page.getByText(/3-Point Contest: \d+ points/)).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 90_000 });
  const bench = page.getByRole("button", { name: "Watch from the bench" });
  await expect(page.locator(".led").nth(1).or(bench).first()).toBeVisible({ timeout: 60_000 });
  if (await bench.isVisible()) await bench.click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim to end" }).click();
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
  await page.waitForURL(/career\/hub\/\?id=/);
  await expect(page.getByText(/All-Star/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the development league and a two-way deal, on screen", async ({ page }) => {
  const errors = watchErrors(page);
  await creator(page, "Fringe");
  await page
    .getByRole("radio", { name: "The pros" })
    .or(page.getByRole("button", { name: "The pros", exact: true }))
    .first()
    .click();
  await page.getByRole("button", { name: "Start career" }).click();
  await page.waitForURL(/career\/hub\/\?id=/);
  await patchCareer(
    page,
    "Fringe",
    `d.pro.preDraft.agent = "family"; d.pro.preDraft.combine = { scores: [], bonus: 0, verticalIn: 30, laneSec: 11, threesMade: 10 }; d.pro.preDraft.workouts = [{}, {}, {}]; d.pro.preDraft.interviews = [0, 0, 0]; d.pro.draft = { year: 2026, picks: [], trades: [], teamId: null, seen: true }; d.pro.undraftedOffers = ["pro-bos"];`,
  );
  await expect(page.getByRole("heading", { name: "Nobody called your name" })).toBeVisible();
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await page.getByRole("list", { name: "Summer focus" }).getByRole("button", { name: "Shooting" }).click();
  await expect(page.getByText(/development team/).first()).toBeVisible();
  await page.getByRole("button", { name: "Sim game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sim game", exact: true })).toBeEnabled({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("the main menu plays the trailer, with no arena name @gpu", async ({ page }) => {
  const errors = watchErrors(page);
  await lowGraphics(page);
  await page.goto("./");
  await expect(page.getByText(/Tonight at/)).toHaveCount(0);
  await expect(page.locator("[data-trailer-shot]")).toHaveAttribute("data-trailer-shot", "break", { timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the graphics preset you pick survives a reload", async ({ page }) => {
  await page.goto("settings/");
  const preset = async () => page.evaluate(() => JSON.parse(localStorage.getItem("bl-settings")!).state.graphics.preset);
  await page
    .getByRole("button", { name: "Graphics" })
    .or(page.getByRole("tab", { name: "Graphics" }))
    .first()
    .click();
  await page
    .getByRole("radio", { name: "Medium" })
    .or(page.getByRole("button", { name: "Medium", exact: true }))
    .first()
    .click();
  await expect.poll(preset).toBe("medium");
  await page.reload();
  await page.waitForTimeout(800);
  expect(await preset()).toBe("medium");
  await page
    .getByRole("radio", { name: "Low" })
    .or(page.getByRole("button", { name: "Low", exact: true }))
    .first()
    .click();
  await page.goto("./");
  await page.waitForTimeout(800);
  expect(await preset()).toBe("low");
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

test("the main menu is in order, and Quick Play has a fast start @gpu", async ({ page }) => {
  await lowGraphics(page);
  await page.goto("./");
  await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("listitem")).toHaveText([
    "Quick Play",
    "Road to Legend",
    /^Franchise/,
    /^Multiplayer/,
    "Play in the Park",
    "Practice and Tutorial",
    "Settings",
    "How to play",
  ]);
  await page.getByRole("link", { name: "Quick Play" }).click();
  await page.getByRole("button", { name: "Fast start (random teams)" }).click();
  await page.waitForURL("**/game/");
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
  await page.getByRole("link", { name: "Practice and Tutorial" }).click();
  await page.getByRole("button", { name: "Start the tutorial" }).click();
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
  await page.getByRole("button", { name: /Maple Street Park/ }).click();
  await page.getByRole("radio", { name: "1v1" }).click();
  await page.getByRole("radio", { name: "2s and 3s" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /Maple Street Park/ })).toHaveAttribute("aria-pressed", "true");
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
