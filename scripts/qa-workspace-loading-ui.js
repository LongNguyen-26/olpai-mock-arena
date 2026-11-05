// Playwright CLI on an authenticated, isolated QA backend. Real snapshot reads;
// delayed/failing responses and all provider/mutation requests are intercepted.
async (page) => {
  const base = new URL(page.url()).origin,
    errors = [],
    requests = { current: 0, history: 0, prices: 0 };
  const snapshot = await (await page.request.get(base + "/api/arena")).json();
  const current = await (
    await page.request.get(base + "/api/workspace/state?view=current")
  ).json();
  const archive = await (
    await page.request.get(base + "/api/workspace/state?view=history")
  ).json();
  if (!snapshot.user?.admin || current.counts?.history < 2)
    throw Error("Use the isolated loading QA fixture");
  current.hasCredential = true;
  current.chatGroups.push({
    id: "00000000-0000-4000-8000-000000000088",
    name: "Trợ lý kiểm tra tải trang",
    provider: "groq",
    model: "qa/model",
    preparingResources: false,
    roundId: snapshot.rounds[0].id,
    scope: "all",
    teamId: null,
    paused: false,
    canManage: false,
    chatbotEnabled: true,
    workspaceIds: [],
    templateId: "qa",
    ready: 1,
    readySlots: 2,
    total: 0,
    estimatedUsd: 0,
    hourlyUsd: 0,
    queue: { queued: 0, running: 0, oldestQueuedAt: null, uncertain: [] },
  });
  const deferred = () => {
    let release;
    const promise = new Promise((r) => (release = r));
    return { promise, release };
  };
  const arenaGate = deferred(),
    firstGate = deferred(),
    priceGate = deferred(),
    historyGate = deferred();
  const gates = [arenaGate, firstGate, priceGate, historyGate];
  let nextGate = null,
    failCurrent = false,
    failPrice = true,
    failHistory = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (req.method() !== "GET") return route.fulfill({ json: { ok: true } });
    if (u.pathname === "/api/arena") {
      await arenaGate.promise;
      return route.fulfill({ json: { ...snapshot, serverNow: Date.now() } });
    }
    if (u.pathname === "/api/workspace/state") {
      if (u.searchParams.get("view") === "history") {
        requests.history++;
        await historyGate.promise;
        return route
          .fulfill({
            status: failHistory ? 503 : 200,
            json: failHistory ? { error: "QA history unavailable" } : archive,
          })
          .catch(() => {});
      }
      requests.current++;
      let gate = requests.current === 1 ? firstGate : nextGate;
      nextGate = null;
      if (gate) await gate.promise;
      return route
        .fulfill({
          status: failCurrent ? 503 : 200,
          json: failCurrent
            ? { error: "QA state unavailable" }
            : { ...current, serverNow: Date.now() },
        })
        .catch(() => {});
    }
    if (u.pathname === "/api/workspace/prices") {
      requests.prices++;
      await priceGate.promise;
      return route
        .fulfill({
          status: failPrice ? 503 : 200,
          json: failPrice
            ? { error: "QA price unavailable" }
            : { gpus: [], fetchedAt: Date.now() },
        })
        .catch(() => {});
    }
    return route.continue();
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("about:blank");
    await page.goto(base + "/#workspace");
    await page.locator(".arena-loading:visible").waitFor({ state: "visible" });
    await page
      .getByRole("heading", { name: "GPU Workspace", exact: true })
      .waitFor();
    await page.screenshot({
      path: "output/playwright/workspace-loading-shell.png",
      fullPage: true,
    });
    arenaGate.release();
    await page
      .locator(".gpu-workspace .workspace-loading")
      .waitFor({ state: "visible" });
    if (requests.history) throw Error("History eagerly loaded");
    await page.screenshot({
      path: "output/playwright/workspace-loading-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Loading mobile overflow");
    await page.screenshot({
      path: "output/playwright/workspace-loading-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    firstGate.release();
    await page
      .getByRole("heading", { name: "Trợ lý kiểm tra tải trang", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Đang lấy giá…", exact: true })
      .waitFor();
    if (requests.history || requests.prices !== 1)
      throw Error("Unexpected eager work");
    if (
      !(await page
        .getByRole("link", { name: /Mở Chatbot/ })
        .first()
        .isVisible())
    )
      throw Error("Slow prices block Chatbot");
    priceGate.release();
    await page.getByText(/Chưa cập nhật được giá GPU/).waitFor();
    await page
      .getByRole("heading", { name: "Trợ lý kiểm tra tải trang", exact: true })
      .waitFor();
    failPrice = false;
    await page
      .getByRole("button", { name: "Cập nhật giá", exact: true })
      .click();
    await page.getByText(/Báo giá .*cache tối đa/).waitFor();
    if (requests.prices !== 2) throw Error("Price retry failed");
    await page.getByRole("button", { name: /Đã thu hồi/ }).click();
    await page.getByText("Đang tải GPU đã thu hồi…", { exact: true }).waitFor();
    if (requests.history !== 1)
      throw Error("Lazy history request missing or duplicated");
    failHistory = true;
    historyGate.release();
    await page.getByText(/Chưa tải được GPU đã thu hồi/).waitFor();
    failHistory = false;
    await page
      .getByRole("button", { name: "Thử tải lịch sử GPU", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".gpu-card").length > 5,
    );
    if (requests.history !== 2) throw Error("History retry failed");
    await page.getByRole("button", { name: /GPU hiện tại/ }).click();
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await nav.getByRole("button", { name: "Tài khoản", exact: true }).click();
    await page
      .getByRole("heading", { name: "Tài khoản", exact: true, level: 1 })
      .waitFor();
    const whileHidden = requests.current;
    await page.waitForTimeout(11000); // Polling must stop while Workspace is hidden.
    if (requests.current !== whileHidden)
      throw Error("Hidden Workspace still polls");
    const refreshGate = deferred();
    gates.push(refreshGate);
    nextGate = refreshGate;
    await nav
      .getByRole("button", { name: "GPU Workspace", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Trợ lý kiểm tra tải trang", exact: true })
      .waitFor();
    await page
      .getByText("Đang cập nhật trạng thái…", { exact: false })
      .waitFor();
    if (await page.locator(".gpu-workspace .workspace-loading").count())
      throw Error("Returning cleared cached Workspace");
    const inFlight = requests.current;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(11000); // One interval and repeated focus share the held read.
    if (requests.current !== inFlight)
      throw Error("Duplicate in-flight Workspace fetch");
    failCurrent = true;
    refreshGate.release();
    await page.getByText(/Chưa tải được trạng thái Workspace/).waitFor();
    await page
      .getByRole("heading", { name: "Trợ lý kiểm tra tải trang", exact: true })
      .waitFor();
    if (
      !(await page
        .getByRole("button", { name: "Cập nhật key", exact: true })
        .isDisabled())
    )
      throw Error("Stale state enabled admin actions");
    failCurrent = false;
    await page
      .getByRole("button", { name: "Thử tải Workspace", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector(".workspace-section-error[role=alert]"),
    );
    await page
      .getByRole("button", { name: "Cập nhật key", exact: true })
      .click({ trial: true });
    await page.screenshot({
      path: "output/playwright/workspace-loading-recovered.png",
      fullPage: true,
    });
    if (errors.length) throw Error(errors.join("; "));
    return {
      result: "PASS",
      checks: [
        "shell before arena response",
        "Workspace skeleton before state",
        "desktop/mobile",
        "history lazy load and retry",
        "prices isolated and retry",
        "cached return",
        "pause hidden polls",
        "single flight across focus and interval",
        "cached state error and recovery",
        "stale admin actions disabled",
      ],
      requests,
      realProviderCalls: 0,
    };
  } finally {
    for (const gate of gates) gate.release();
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
}
