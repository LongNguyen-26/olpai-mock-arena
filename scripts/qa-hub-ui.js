// Playwright CLI: the Arena backend uses a disposable QA namespace. Pod calls are intercepted.
async (page) => {
  const base = "http://localhost:3018",
    errors = [],
    mutations = [];
  const check = (v, m) => {
    if (!v) throw new Error(m);
  };
  page.on("pageerror", (e) => errors.push(e.message));
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
    const student = page.locator(".hub-panel");
    await student
      .getByRole("button", { name: "Xin lượt", exact: true })
      .click();
    await student
      .getByRole("button", { name: "Bắt đầu dùng", exact: true })
      .click();
    await student.getByText("Team A — đang dùng", { exact: true }).waitFor();
    check(
      (await student.locator(".hub-team").count()) === 1,
      "Student saw another team's server",
    );
    check(
      (await student
        .getByRole("button", { name: "Cấp workspace", exact: true })
        .count()) === 0,
      "Student saw admin controls",
    );
    await student
      .getByRole("button", { name: "Trả lượt", exact: true })
      .click();
    await student.getByText("Chưa có đăng ký.", { exact: true }).waitFor();
    await page.screenshot({
      path: "output/playwright/hub-student-mobile.png",
      fullPage: true,
    });
    check(mutations.length === 0, "Unexpected provider control");
    check(errors.length === 0, "Page errors: " + errors.join("; "));
    console.log(
      "PASS Hub UI: admin adds a team through the real QA API/Redis, safe stop confirmation, student isolation, request/start/release GPU turns, desktop/mobile; no real Pod.",
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
