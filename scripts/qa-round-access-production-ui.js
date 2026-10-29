/** Auth loaded from .local by the CLI. Inspect/cancel only; block every non-auth POST. */
async page => {
  const base = "https://olpai-mock-arena.vercel.app";
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], failures = [], blocked = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.url().startsWith(base) && r.status() >= 500) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!["GET", "HEAD"].includes(req.method()) && path !== "/api/auth/logout") { blocked.push(path);await route.abort(); }
    else await route.continue();
  });
  try {
    await page.setViewportSize({ width: 1600, height: 1050 });
    await page.goto(base + "/");
    const response = await page.request.get(base + "/api/arena");check(response.ok(), "Production session");
    const catalog = await response.json();check(catalog.user.admin, "Admin view");
    const phases = [];
    for (const [i, round] of catalog.rounds.entries()) {
      await page.goto(base + "/?round=" + encodeURIComponent(round.id) + "#admin");
      await page.locator(".round-access-controls").waitFor();
      check(await page.locator(".round-access-table tbody tr").count() === 4, "Missing access controls");
      check(await page.getByRole("checkbox", { name: "Hiện public submission", exact: true }).count() === 1, "Public visibility");
      check(await page.getByRole("checkbox", { name: "Hiện private submission", exact: true }).count() === 1, "Private visibility");
      check(await page.getByRole("checkbox", { name: "Cho phép mở JupyterLab từ web", exact: true }).count() === 1, "Lab control");
      check((await page.locator(".round-access-table tbody tr").first().innerText()).includes("Nhận bài nộp"), "Submission acceptance label");
      const snapshot = await (await page.request.get(base + "/api/arena?round=" + encodeURIComponent(round.id))).json();
      phases.push(snapshot.phase);
      const dialog = page.getByRole("dialog");
      await page.getByRole("button", { name: "Đặt lại / mở lượt mới", exact: true }).click();await dialog.waitFor();
      check(await dialog.locator('input[name="keepLeaderboard"]').isChecked(), "Reset keep leaderboard default");
      await page.keyboard.press("Escape");await dialog.waitFor({ state: "detached" });
      if (["waiting", "scheduled", "public"].includes(snapshot.phase)) {
        check(await page.locator(".private-policy-form input[type=checkbox]").count() === 2, "Private transition policy");
      }
      if (["public", "private", "practice"].includes(snapshot.phase)) {
        await page.getByRole("button", { name: "Điều chỉnh thời gian", exact: true }).click();await dialog.waitFor();
        check(await dialog.locator('input[name="endAt"]').count() === 1, "Live timing editor");
        await page.keyboard.press("Escape");await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Cấp / hẹn giờ", exact: true }).click();await dialog.waitFor();
        check(await dialog.locator('input[name="chatbotUntil"]').count() === 1, "Chatbot expiry editor");
        await page.keyboard.press("Escape");await dialog.waitFor({ state: "detached" });
      }
      if (snapshot.phase === "public") {
        await page.getByRole("button", { name: "Chuyển sang private ngay", exact: true }).click();await dialog.waitFor();
        check(await dialog.locator('input[type="checkbox"]').count() === 2, "Private dialog choices");
        await page.keyboard.press("Escape");await dialog.waitFor({ state: "detached" });
      }
      if (["waiting", "scheduled", "ended"].includes(snapshot.phase)) {
        await page.getByRole("button", { name: "Mở luyện tập tiếp", exact: true }).click();await dialog.waitFor();
        check(await dialog.locator('input[name="publicVisible"]').isChecked(), "Practice public default");
        check(await dialog.locator('input[name="privateVisible"]').isChecked(), "Practice private default");
        check(!(await dialog.locator('input[name="chatbotEnabled"]').isChecked()), "Practice chatbot default");
        await page.keyboard.press("Escape");await dialog.waitFor({ state: "detached" });
      }
      if (i === 0) {
        await page.screenshot({ path: "output/playwright/round-access-production-desktop.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Production mobile overflow");
        await page.screenshot({ path: "output/playwright/round-access-production-mobile.png", fullPage: true });
        await page.setViewportSize({ width: 1600, height: 1050 });
      }
    }
    check(catalog.rounds.length > 0, "No production rounds available to inspect");
    check(blocked.length === 0, "Unexpected write attempted: " + blocked.join(","));
    check(errors.length === 0, errors.join("\n"));check(failures.length === 0, "Production HTTP 5xx");
    console.log(JSON.stringify({ result: "PASS", roundCount: catalog.rounds.length, phases, pageErrors: errors.length, serverErrors: failures.length, roundOrPodMutations: 0, desktop: 1600, mobile: 390 }));
  } finally {
    const logout = await page.request.post(base + "/api/auth/logout", { headers: { Origin: base }, data: {} });
    check(logout.ok(), "Production logout");await page.context().clearCookies();await page.goto(base + "/login");
  }
}
