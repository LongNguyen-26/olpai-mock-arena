// Playwright CLI callback. Isolated QA authentication; all Pod mutations mocked.
async (page) => {
  const base = "http://localhost:3010", errors = [], actions = [];
  let groupSize = 2;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const contexts = [page.context()];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (p, username) => {
    await p.goto(base + "/login");
    await p.getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true }).fill(username);
    await p.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill("Arena-GPU-QA-Only-2026!");
    await p.locator("form").getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.waitForURL(base + "/");
  };
  await page.context().clearCookies();
  try {
    await login(page, "qa_gpu_admin");
    const state = await (await page.request.get(base + "/api/workspace/state")).json();
    const originalGroup = state.chatGroups.find((g) => g.workspaceIds?.length);
    check(!!originalGroup, "Missing QA group");
    const source = state.workspaces.find((w) => w.chatGroupId === originalGroup.id && w.podId);
    const now = Date.now();
    const health = { ...source.health, llm: true, jupyter: false, gpu: "NVIDIA A40, 19643, 46068, 37, 49", stage: "Dịch vụ sẵn sàng", modelStage: "DeepSeek sẵn sàng" };
    const worker1 = { ...source, status: "running", health, metricsVisible: true, uptimeSeconds: 900, uptimeObservedAt: now, estimatedUsd: 0.2342, meterRate: 0.59, error: null, syncedAt: now };
    const worker2 = { ...worker1, id: "10000000-0000-4000-8000-000000000002", podId: "qaSecondGpu2", metricsVisible: false, health: { ...health, gpu: "NVIDIA A40, 18000, 46068, 82, 56" } };
    const llm = { ...worker1, id: "10000000-0000-4000-8000-000000000003", podId: "qaChatOnly3", chatGroupId: undefined, services: "llm", chatbotEnabled: true };
    const jupyter = { ...worker1, id: "10000000-0000-4000-8000-000000000004", podId: "qaJupyter4", chatGroupId: undefined, services: "jupyter", notebookEnabled: true, template: { ...worker1.template, gpuTypeId: "NVIDIA RTX A5000" }, health: { ...health, llm: false, jupyter: true } };
    const past = { ...worker1, id: "10000000-0000-4000-8000-000000000005", status: "terminated", health: null };
    const group = { ...originalGroup, name: "Chatbot chung — Thi thử", canManage: true, chatbotEnabled: true, workspaceIds: [worker1.id, worker2.id, past.id], ready: 1, total: 2, estimatedUsd: 0.7542, hourlyUsd: 1.18, queue: { running: 2, queued: 5, oldestQueuedAt: now - 90000, uncertain: [] } };
    const operations = [worker1, worker2].map((w, i) => ({ id: w.id, canManage: true, groupId: group.id, draining: i === 1, worker: { ready: true, protocol: 1, heartbeatAt: now, runId: w.runId }, queue: null }));
    const attach = async (context, role) => {
      await context.route("**/api/workspace/**", async (route) => {
        const path = new URL(route.request().url()).pathname.split("/workspace/")[1];
        if (path === "state") {
          const admin = role !== "member";
          const workspaces = [worker1, worker2, llm, jupyter, past].filter((w) => w.id !== worker2.id || groupSize > 1).filter((w) => w.id !== worker1.id || groupSize > 0).map((w) => {
            if (admin || w.metricsVisible !== false) return w;
            const { gpu, ...safeHealth } = w.health ?? {};
            return { ...w, health: w.health ? safeHealth : null, uptimeSeconds: undefined, uptimeObservedAt: undefined };
          });
          return route.fulfill({ json: { ...state, serverNow: Date.now(), workspaces,
            chatGroups: [admin ? { ...group, canManage: role === "owner" } : { id: group.id, name: group.name, roundId: group.roundId, scope: group.scope, paused: group.paused, chatbotEnabled: group.chatbotEnabled, canManage: false }],
            chatOperations: admin ? operations.map((o) => ({ ...o, canManage: role === "owner" })) : [],
            templates: admin ? state.templates : [], hasCredential: admin,
          } });
        }
        if (path === "prices") return route.fulfill({ json: { fetchedAt: now, gpus: [{ id: "NVIDIA A40", name: "A40", memory: 48, price: { secure: .7, community: .59 } }] } });
        if (path === "gpu-resources") return route.fulfill({ json: { minRAMPerGPU: 48, minVCPUPerGPU: 8 } });
        if (route.request().method() !== "GET") {
          const payload = route.request().postDataJSON();
          actions.push({ path, payload });
          if (path === "group/control") {
            group.paused = payload.action === "pause";
            group.chatbotEnabled = !group.paused;
          }
          if (path === "worker-drain") operations.find((o) => o.id === payload.id).draining = payload.draining;
          return route.fulfill({ json: {} });
        }
        return route.fulfill({ status: 409, json: { error: "Unexpected QA path" } });
      });
    };
    await attach(page.context(), "owner");
    await page.setViewportSize({ width: 1600, height: 1080 });
    await page.goto(base + "/?round=" + source.roundId + "#workspace");
    const panel = page.locator(".chat-group");
    await panel.getByRole("link", { name: /Mở Chatbot/ }).waitFor();
    check(await panel.locator(".gpu-worker-card").count() === 2, "GPU workers not contained together");
    check(await page.locator(".gpu-worker-card").count() === 2, "GPU worker duplicated outside group");
    check(await panel.locator(".gpu-service-card").count() === 0, "Redundant Worker Chatbot panel remains");
    check(await panel.locator(".chat-stat.is-running strong").textContent() === "2", "Running total missing");
    check(await panel.locator(".chat-stat.is-queued strong").textContent() === "5", "Queue total missing");
    check(await panel.locator(".gpu-telemetry").count() === 2, "Admin lost metrics on hidden Pod");
    await panel.locator(".chat-worker-selector").nth(1).click();
    check(await panel.locator(".chat-worker-selector").nth(1).getAttribute("aria-pressed") === "true", "GPU selection did not change");
    for (const [id, title, absent] of [[llm.id, "Chatbot", "JupyterLab"], [jupyter.id, "JupyterLab", "Chatbot"]]) {
      const card = page.locator("#pod-" + id);
      check(await card.locator(".gpu-service-card").count() === 1, "Single-service Pod has multiple tiles");
      check(await card.getByRole("heading", { name: title, exact: true }).count() === 1, "Expected service missing");
      check(await card.getByRole("heading", { name: absent, exact: true }).count() === 0, "Disabled service still shown");
    }
    check(await page.getByRole("button", { name: /GPU hiện tại 4/ }).count() === 1, "Group workers missing from GPU count");
    const ops = page.getByRole("region", { name: "Điều phối Chatbot" });
    check(await ops.locator(".chat-operation").count() === 2, "Worker operations missing");
    check(await ops.locator(".chat-group").count() === 0, "Operations nested in group");
    await ops.getByRole("button", { name: "Tiếp tục giao việc", exact: true }).click();
    await ops.getByText("Đã ngừng giao việc mới", { exact: true }).waitFor({ state: "detached" });
    await panel.getByRole("button", { name: "Tạm ngừng nhận prompt mới", exact: true }).click();
    await panel.getByRole("button", { name: "Tiếp tục nhận prompt", exact: true }).waitFor();
    check(await panel.locator(".chat-launch").getAttribute("aria-disabled") === "true", "Paused group link still enabled");
    await panel.getByRole("button", { name: "Tiếp tục nhận prompt", exact: true }).click();
    await panel.getByRole("link", { name: /Mở Chatbot/ }).waitFor();
    await panel.screenshot({ path: "output/playwright/workspace-group-admin-desktop.png" });
    await ops.screenshot({ path: "output/playwright/workspace-operations-desktop.png" });
    await panel.getByRole("button", { name: "Thêm Pod", exact: true }).click();
    check(await page.locator(".gpu-deploy-panel").getByRole("combobox", { name: "Nhóm Chatbot", exact: true }).inputValue() === group.id, "Add Pod did not select existing group");
    for (const width of [1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Admin overflow at " + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: "output/playwright/workspace-group-admin-mobile.png" });
    await ops.screenshot({ path: "output/playwright/workspace-operations-mobile.png" });
    const otherContext = await page.context().browser().newContext(); contexts.push(otherContext);
    await attach(otherContext, "viewer");
    const other = await otherContext.newPage(); other.on("pageerror", (e) => errors.push(e.message));
    await login(other, "qa_gpu_admin2");
    await other.goto(base + "/?round=" + source.roundId + "#workspace");
    await other.locator(".chat-group").waitFor();
    check(await other.locator(".chat-group .gpu-actions").count() === 0, "Other admin has owner controls");
    check(await other.locator(".chat-add-pod").count() === 0, "Other admin can allocate into owner's group");
    const memberContext = await page.context().browser().newContext(); contexts.push(memberContext);
    await attach(memberContext, "member");
    const member = await memberContext.newPage(); member.on("pageerror", (e) => errors.push(e.message));
    await login(member, "qa_gpu_member_0_0");
    await member.goto(base + "/?round=" + source.roundId + "#workspace");
    const memberPanel = member.locator(".chat-group");
    await memberPanel.getByRole("link", { name: /Mở Chatbot/ }).waitFor();
    check(await member.getByRole("heading", { name: "Nhóm Chatbot", exact: true }).count() === 0, "Contestant sees group terminology");
    check(await member.locator(".chat-group-stats,.chat-operations,.chat-group-actions,.gpu-actions").count() === 0, "Contestant sees coordination or controls");
    const hidden = member.locator("#pod-" + worker2.id);
    check(await hidden.getByText("Quản trị viên đang ẩn thông số tài nguyên GPU.").count() === 1, "Metrics privacy ignored");
    check(await memberPanel.locator(".chat-worker-selector").nth(1).locator(".chat-selector-metrics").count() === 0, "Selector leaks hidden metrics");
    check(await memberPanel.locator(".chat-group-cost strong").count() === 0, "Mixed hidden metrics leak aggregate");
    await member.setViewportSize({ width: 1600, height: 1080 });
    await memberPanel.screenshot({ path: "output/playwright/workspace-group-member-desktop.png" });
    await member.setViewportSize({ width: 390, height: 844 });
    check(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Member mobile overflow");
    await memberPanel.screenshot({ path: "output/playwright/workspace-group-member-mobile.png" });
    groupSize = 1; group.total = 1; group.ready = 1;
    await page.setViewportSize({ width: 1600, height: 1080 });
    await page.getByRole("button", { name: "Làm mới", exact: true }).click();
    await panel.locator(".chat-worker-selector").nth(1).waitFor({ state: "detached" });
    check(await panel.locator(".gpu-worker-card").count() === 1, "One-Pod group did not render correctly");
    await panel.screenshot({ path: "output/playwright/workspace-group-one-pod.png" });
    groupSize = 0; group.total = 0; group.ready = 0;
    await page.getByRole("button", { name: "Làm mới", exact: true }).click();
    await panel.locator(".chat-group-empty").waitFor();
    check(await panel.getByRole("button", { name: "Đóng nhóm", exact: true }).isEnabled(), "Empty group cannot be closed");
    check(!actions.some((a) => /deploy|credential/.test(a.path)), "QA issued an allocation/credential mutation");
    check(errors.length === 0, errors.join("\n"));
    return { passed: true, desktopAndMobile: true, roles: ["owner", "other admin", "contestant"], groupedWorkers: 2, singleServiceTiles: true, provider: "mocked", paidPodsCreated: 0 };
  } finally {
    for (const context of contexts) {
      for (const p of context.pages()) await p.goto("about:blank").catch(() => {});
      await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } }).catch(() => {});
      await context.clearCookies();
      await context.unrouteAll();
      if (context !== page.context()) await context.close();
    }
  }
}
