// Playwright CLI callback: isolated QA auth/template writes; provider/worker state mocked.
async (page) => {
  const base = "http://localhost:3010",
    errors = [],
    saves = [];
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const groupId = "00000000-0000-4000-8000-000000000042";
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().clearCookies();
  await page
    .context()
    .route("**/api/workspace/sync", (r) => r.fulfill({ json: {} }));
  await page.context().route("**/api/workspace/prices", (r) =>
    r.fulfill({
      json: {
        fetchedAt: Date.now(),
        gpus: [
          {
            id: "NVIDIA A40",
            name: "A40",
            memory: 48,
            price: { secure: 0.59, community: 0.59 },
          },
        ],
      },
    }),
  );
  page.on("request", (r) => {
    if (r.url().endsWith("/api/workspace/template") && r.method() === "POST")
      saves.push(r.postDataJSON());
  });
  await page.goto(base + "/login");
  await page
    .getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true })
    .fill("qa_gpu_admin");
  await page
    .getByRole("textbox", { name: "Mật khẩu", exact: true })
    .fill("Arena-GPU-QA-Only-2026!");
  await page
    .locator("form")
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .click();
  await page.waitForURL(base + "/");
  const state = await (
    await page.request.get(base + "/api/workspace/state")
  ).json();
  const workspace = state.workspaces.find((w) => w.status === "running");
  check(!!workspace, "Missing isolated QA workspace");
  const before = workspace.template.llmParallel ?? 1;
  await page.context().route("**/api/workspace/state", async (route) => {
    const response = await route.fetch(),
      s = await response.json();
    s.chatGroups = [
      {
        id: groupId,
        name: "QA concurrent group",
        roundId: workspace.roundId,
        scope: "all",
        teamId: null,
        paused: false,
        canManage: false,
        chatbotEnabled: true,
        workspaceIds: [],
        templateId: workspace.template.id,
        ready: 2,
        readySlots: 8,
        total: 2,
        estimatedUsd: 0,
        hourlyUsd: 1.18,
        queue: {
          running: 6,
          queued: 2,
          oldestQueuedAt: Date.now(),
          uncertain: [],
        },
      },
    ];
    s.chatOperations = [
      {
        id: workspace.id,
        groupId,
        draining: false,
        canManage: false,
        worker: {
          workspaceId: workspace.id,
          runId: workspace.runId,
          ready: true,
          protocol: 2,
          capacity: 4,
          fingerprint: "qa",
          heartbeatAt: Date.now(),
        },
        queue: { running: 3, queued: 2, uncertain: [] },
      },
    ];
    await route.fulfill({ response, json: s });
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(base + "/?round=" + workspace.roundId + "#workspace");
  await page.getByRole("button", { name: /Chỉ Chatbot/ }).click();
  const form = page.locator(".gpu-template-panel");
  await form
    .getByRole("combobox", { name: "Template đã lưu", exact: true })
    .selectOption("");
  const concurrency = form.getByRole("combobox", {
    name: "Lượt xử lý đồng thời / GPU",
    exact: true,
  });
  check(
    (await concurrency.inputValue()) === "4",
    "New LLM template must default to four slots",
  );
  check(
    JSON.stringify(
      await concurrency
        .locator("option")
        .evaluateAll((nodes) => nodes.map((n) => n.value)),
    ) === JSON.stringify(["1", "2", "4", "8"]),
    "Unexpected concurrency choices",
  );
  await concurrency.selectOption("8");
  await form
    .getByRole("textbox", { name: "Tên template", exact: true })
    .fill("QA concurrent " + Date.now());
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/workspace/template") &&
      r.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Lưu template", exact: true }).click();
  check((await saved).ok(), "Concurrent template save failed");
  await page
    .getByRole("status")
    .filter({ hasText: "Đã lưu template;" })
    .waitFor();
  check(saves.at(-1).llmParallel === 8, "Save omitted concurrency");
  check(
    (await concurrency.inputValue()) === "8",
    "Reload lost saved concurrency",
  );
  await page
    .getByText("8 lượt xử lý đồng thời sẵn sàng", { exact: true })
    .waitFor();
  await page
    .getByText(/3 lượt chạy · 2 lượt chờ · 4 lượt đồng thời \/ GPU/)
    .waitFor();
  const record = (
    await (await page.request.get(base + "/api/workspace/state")).json()
  ).workspaces.find((w) => w.id === workspace.id);
  check(
    (record.template.llmParallel ?? 1) === before,
    "Template edit mutated an existing allocation",
  );
  await concurrency.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/chat-concurrency-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await concurrency.scrollIntoViewIfNeeded();
  check(await concurrency.isVisible(), "Concurrent setting missing on mobile");
  await page.screenshot({
    path: "output/playwright/chat-concurrency-mobile.png",
  });
  await page.getByRole("button", { name: /Chỉ JupyterLab/ }).click();
  check(
    (await page
      .getByRole("combobox", {
        name: "Lượt xử lý đồng thời / GPU",
        exact: true,
      })
      .count()) === 0,
    "Jupyter-only form exposes LLM concurrency",
  );
  check(errors.length === 0, "Browser errors: " + errors.join("; "));
  await page.context().clearCookies();
  console.log(
    "PASS concurrent UI: choices/default/save, immutable existing allocation, v2 worker and eight-slot group, desktop/mobile, Jupyter-only hidden; provider/model mocked.",
  );
};
