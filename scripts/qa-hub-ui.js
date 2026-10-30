// Playwright CLI: the Arena backend uses a disposable QA namespace. Pod calls are intercepted.
async (page) => {
  const base = "http://localhost:3018",
    errors = [],
    mutations = [];
  const serverRequests = [];
  const check = (v, m) => {
    if (!v) throw new Error(m);
  };
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/workspace/hub/server")
      serverRequests.push(r.url());
  });
  await page.context().clearCookies();
  await page
    .context()
    .route("**/api/workspace/sync", (r) => r.fulfill({ json: {} }));
  await page.context().route("**/api/workspace/control", (r) => {
    mutations.push("provider-control");
    return r.fulfill({
      status: 409,
      json: { error: "Real Pod controls disabled in QA" },
    });
  });
  await page
    .context()
    .route("**/api/workspace/prices", (r) =>
      r.fulfill({ json: { gpus: [], fetchedAt: Date.now() } }),
    );
  async function login(name) {
    await page.goto(base + "/login");
    await page
      .getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true })
      .fill(name);
    await page
      .getByRole("textbox", { name: "Mật khẩu", exact: true })
      .fill("Hub-UI-QA-Only-2026!");
    await page
      .locator("form")
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .click();
    await page.waitForURL(base + "/");
  }
  try {
    await login("qa_hub_admin");
    const state = await (
      await page.request.get(base + "/api/workspace/state")
    ).json();
    const host = state.workspaces.find(
      (w) => w.jupyterMode === "team-hub" && !w.manual,
    );
    check(host, "Missing QA Hub host");
    await page.goto(base + "/?round=" + host.roundId + "#workspace");
    const panel = page
      .locator(".hub-host")
      .filter({ has: page.locator("#pod-" + host.id) })
      .locator(".hub-panel");
    await panel
      .getByRole("heading", { name: "JupyterLab riêng từng team", exact: true })
      .waitFor();
    check((await panel.locator(".hub-team").count()) === 2, "Wrong team count");
    await panel
      .getByLabel("Thêm team đã được duyệt")
      .selectOption({ label: "Team C" });
    await panel
      .getByRole("button", { name: "Cấp workspace", exact: true })
      .click();
    await panel.getByText("Team C", { exact: true }).first().waitFor();
    check(
      (await panel.locator(".hub-team").count()) === 3,
      "Fourth/later team was not added dynamically",
    );
    await panel
      .getByRole("button", { name: "Dừng workspace", exact: true })
      .first()
      .click();
    await panel
      .getByText(
        "Dừng workspace sẽ ngắt kernel và job của riêng team này. Tệp trên volume được giữ.",
        { exact: true },
      )
      .waitFor();
    await panel.getByRole("button", { name: "Quay lại", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "output/playwright/hub-admin-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile horizontal overflow",
    );
    await page.screenshot({
      path: "output/playwright/hub-admin-mobile.png",
      fullPage: true,
    });
    await page.request.post(base + "/api/auth/logout", {
      headers: { Origin: base },
    });
    await page.context().clearCookies();
    await login("qa_hub_member1");
    await page.goto(base + "/?round=" + host.roundId + "#workspace");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const student = page.locator(".hub-panel");
    const card = page.locator("#pod-" + host.id);
    const openLab = card.getByRole("link", { name: "Mở JupyterLab", exact: true });
    await openLab.waitFor();
    check((await openLab.getAttribute("href")) === "/api/workspace/launch?id=" + host.id,
      "Student Lab entry is missing from GPU card or selects a foreign team");
    check((await student.locator(".hub-team").count()) === 0, "Student saw server-management layout");
    check((await page.getByRole("heading", { name: "JupyterLab riêng từng team", exact: true }).count()) === 0,
      "Student saw implementation details");
    for (const name of ["Khởi động", "Dừng workspace", "Cấp workspace", "Thu hồi quyền"])
      check((await page.getByRole("button", { name, exact: true }).count()) === 0, "Student saw " + name);
    for (const action of ["start", "stop"]) {
      const denied = await page.request.post(base + "/api/workspace/hub/server", {
        headers: { Origin: base },
        data: { id: host.id, action, requestId: crypto.randomUUID() },
      });
      check(denied.status() === 403, "Student API could " + action + " workspace");
    }
    await page.context().route("**/api/workspace/launch?**", r => r.fulfill({
      contentType: "text/html", body: "<p>JupyterLab QA destination</p>",
    }));
    const popupEvent = page.waitForEvent("popup");
    await openLab.click();
    const popup = await popupEvent;
    await popup.getByText("JupyterLab QA destination").waitFor();
    await popup.close();
    await page.goto(base + "/workspace/hub?id=" + host.id);
    await page.getByText("JupyterLab QA destination").waitFor();
    await page.goto(base + "/?round=" + host.roundId + "#workspace");
    await student
      .getByRole("button", { name: "Xin lượt", exact: true })
      .click();
    await student
      .getByRole("button", { name: "Bắt đầu dùng", exact: true })
      .click();
    await student.getByText("Đang dùng GPU", { exact: true }).waitFor();
    check((await student.getByRole("button", { name: "Xin lượt", exact: true }).count()) === 0,
      "Using team still sees an invalid request action");
    check(
      (await student
        .getByRole("button", { name: "Cấp workspace", exact: true })
        .count()) === 0,
      "Student saw admin controls",
    );
    await page.screenshot({ path: "output/playwright/hub-student-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "Student mobile horizontal overflow");
    await page.screenshot({ path: "output/playwright/hub-student-mobile.png", fullPage: true });
    await student
      .getByRole("button", { name: "Trả lượt", exact: true })
      .click();
    await student.getByText("Chưa đăng ký", { exact: true }).waitFor();
    await student.getByRole("button", { name: "Xin lượt", exact: true }).click();
    await student.getByRole("button", { name: "Hủy đăng ký", exact: true }).click();
    await student.getByText("Chưa đăng ký", { exact: true }).waitFor();
    // Exercise fresh, stopped, stale and failed servers without touching runtime/Pod.
    const original = await (await page.request.get(base + "/api/workspace/state")).json();
    let scenario;
    await page.context().route("**/api/workspace/state", r => r.fulfill({ json: scenario ?? original }));
    for (const [name, desiredState, serverState, expected] of [
      ["stopped", "stopped", "stopped", "Chưa mở"],
      ["starting", "running", "starting", "Đang chuẩn bị"],
      ["stale", "running", null, "Đang chuẩn bị"],
      ["error", "running", "error", "Cần hỗ trợ"],
      ["locked", "running", "ready", "Đang khóa truy cập"],
    ]) {
      scenario = structuredClone(original);
      const w = scenario.workspaces.find(w => w.id === host.id);
      w.notebookEnabled = false;
      w.hub.teams[0].desiredState = desiredState;
      w.hub.teams[0].server = serverState ? { ...w.hub.teams[0].server, state: serverState } : null;
      await page.reload();
      await card.locator(".gpu-service-status").getByText(expected, { exact: true }).waitFor();
      check((await card.getByRole("link", { name: "Mở JupyterLab", exact: true }).count()) === 0,
        "Lab link stayed enabled for " + name);
    }
    scenario = structuredClone(original);
    const pulling = scenario.workspaces.find(w => w.id === host.id);
    pulling.status = "provisioning";
    pulling.notebookEnabled = false;
    pulling.startupProgress = "pulling";
    pulling.health.stage = "Runpod đang tải image Docker trên host; still fetching image";
    pulling.error = "Runpod đang giải nén image Docker trên host; System Logs";
    await page.reload();
    await card.getByText("Đang chuẩn bị GPU", { exact: true }).waitFor();
    check(!/Runpod đang|still fetching image|System Logs/.test(await card.innerText()),
      "Provider diagnostics leaked to contestant card");
    check(serverRequests.length === 0, "Opening Lab submitted a start/stop mutation");
    check(mutations.length === 0, "Unexpected provider control");
    check(errors.length === 0, "Page errors: " + errors.join("; "));
    console.log(
      "PASS Hub UI: admin controls preserved; student GPU-card Lab link and legacy bookmark are read-only; start/stop API 403; request/start/release/cancel GPU turns; stopped/starting/stale/error/locked states; no provider logs; desktop/mobile. Real QA API/Redis, mocked Pod only.",
    );
  } finally {
    await page.request.post(base + "/api/auth/logout", {
      headers: { Origin: base },
    });
    await page.goto("about:blank");
    await page.context().clearCookies();
    await page.context().unrouteAll();
  }
};
