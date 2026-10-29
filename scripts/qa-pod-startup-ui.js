// Playwright CLI callback: isolated QA login, mocked provider state/mutations.
async (page) => {
  const base = "http://localhost:3010", errors = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  let mode = "failed", syncs = 0, controls = 0;
  await page.context().unrouteAll();
  await page.context().clearCookies();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().route("**/api/workspace/sync", (route) => {
    syncs++;
    return route.fulfill({ json: {} });
  });
  await page.context().route("**/api/workspace/control", (route) => {
    controls++;
    return route.fulfill({ status: 409, json: { error: "QA provider control disabled" } });
  });
  await page.context().route("**/api/workspace/prices", (route) => route.fulfill({
    json: { fetchedAt: Date.now(), gpus: [] },
  }));
  try {
    await page.goto(base + "/login");
    await page.getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true }).fill("qa_gpu_admin");
    await page.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill("Arena-GPU-QA-Only-2026!");
    await page.locator("form").getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL(base + "/");
    const state = await (await page.request.get(base + "/api/workspace/state")).json();
    const group = state.chatGroups.find((g) => g.workspaceIds?.length);
    check(!!group, "Missing isolated QA group");
    const original = state.workspaces.find((w) => w.id === group.workspaceIds[0]);
    check(!!original?.podId, "Missing QA worker Pod");
    const diagnostic = "GPU trên host Runpod cần reset; container chưa khởi động được.";
    await page.context().route("**/api/workspace/state", (route) => route.fulfill({
      json: {
        ...state,
        workspaces: [{
          ...original, status: mode,
          health: mode === "running" ? { ...original.health, llm: true, stage: "ready" } : null,
          startupFailure: mode === "failed" ? "gpu-reset" : null,
          error: mode === "failed" ? diagnostic : null,
        }],
      },
    }));
    await page.goto(base + "/?round=" + original.roundId + "#workspace");
    const card = page.locator("#pod-" + original.id);
    await card.getByText("Lỗi khởi động Pod", { exact: true }).waitFor();
    await card.getByText(diagnostic, { exact: true }).waitFor();
    check((await card.getByText("Pod đang chạy", { exact: true }).count()) === 0, "Host failure advertised as running");
    check(await card.getByRole("button", { name: "Dừng Pod chung", exact: true }).isEnabled(), "Failed confirmed Pod cannot be stopped");
    check(await card.getByRole("button", { name: "Thu hồi Pod", exact: true }).isEnabled(), "Failed Pod cannot be reclaimed");
    check((await card.getByRole("button", { name: "Hủy yêu cầu lỗi", exact: true }).count()) === 0, "Confirmed Pod offered allocation cancellation");
    await page.waitForFunction(() => document.querySelector(".gpu-card") !== null);
    check(syncs > 0, "Admin did not automatically reconcile failed confirmed Pod");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await card.screenshot({ path: "output/playwright/pod-startup-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile overflow");
    await card.screenshot({ path: "output/playwright/pod-startup-mobile.png" });
    mode = "provisioning";
    await page.getByRole("button", { name: "Làm mới", exact: true }).click();
    await card.getByText("Container chưa sẵn sàng", { exact: true }).waitFor();
    mode = "running";
    await page.getByRole("button", { name: "Làm mới", exact: true }).click();
    await card.getByText("Pod đang chạy", { exact: true }).waitFor();
    check((await card.getByText(diagnostic, { exact: true }).count()) === 0, "Old startup error survived recovery");
    check(controls === 0, "QA unexpectedly controlled a Pod");
    check(errors.length === 0, "Browser page errors: " + errors.join("; "));
    console.log("PASS Pod startup UI: host error, safe controls, automatic Admin sync, recovery, desktop/mobile; provider mocked.");
  } finally {
    await page.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
    await page.goto("about:blank");
    await page.context().clearCookies();
    await page.context().unrouteAll();
  }
}
