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

test("the beta warning shows only in the beta build", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("complementary", { name: "Beta warning" })).toHaveCount(BASE === "/beta" ? 1 : 0);
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

test("save and quit, then resume from the main menu @gpu", async ({ page }) => {
  test.setTimeout(180_000);
  await lowGraphics(page);
  await page.goto("play/");
  await page.getByRole("button", { name: "Play game" }).click();
  await page.waitForURL("**/game/");
  await expect(page.getByText("Loading the arena")).toBeHidden({ timeout: 60_000 });
  await clockRuns(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save and quit" }).click();
  await page.waitForURL((u) => new URL(u).pathname === `${BASE}/`);
  const resume = page.getByRole("button", { name: "Resume game" });
  await expect(resume).toBeVisible();
  await resume.click();
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
