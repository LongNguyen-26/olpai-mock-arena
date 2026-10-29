// Playwright CLI callback: real isolated QA auth, resource cache and template save.
// Price catalogue and automatic sync are mocked; no provider mutation is allowed.
async (page) => {
  const base = "http://127.0.0.1:3010", errors = [], requests = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.context().clearCookies();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", request => errors.push(request.method() + " " + new URL(request.url()).pathname));
  await page.context().route("**/api/workspace/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/prices")) return route.fulfill({ json: {
      fetchedAt: Date.now(),
      gpus: [{ id: "NVIDIA A40", name: "A40", memory: 48, price: { secure: 0.59, community: 0.35 } }],
    } });
    if (path.endsWith("/sync")) return route.fulfill({ json: {} });
    if (["/state", "/teams", "/template", "/gpu-resources"].some(end => path.endsWith(end))) {
      if (route.request().method() === "POST") requests.push({ path, body: route.request().postDataJSON() });
      return route.continue();
    }
    throw new Error("Unexpected Workspace operation: " + path);
  });
  try {
    await page.goto(base + "/login");
    await page.getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true }).fill("qa_gpu_admin");
    await page.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill("Arena-GPU-QA-Only-2026!");
    await page.locator("form").getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL(base + "/");
    const arena = await (await page.request.get(base + "/api/arena")).json();
    const round = arena.rounds[0].id;
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(base + "/?round=" + round + "#workspace");
    const form = page.locator(".gpu-template-panel");
    const cloud = form.getByRole("combobox", { name: "Cloud", exact: true });
    await cloud.waitFor();
    check((await cloud.locator("option").allTextContents()).join(",") === "Community,Secure,All", "Cloud choices incorrect");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    const buttons = await nav.getByRole("button").allTextContents();
    check(buttons.findIndex(text => text.includes("Quản trị vòng")) < buttons.findIndex(text => text.includes("Đội & thí sinh")), "Admin menu order incorrect");
    for (const selected of ["ALL", "COMMUNITY", "SECURE", "ALL"]) {
      const response = page.waitForResponse(response => response.url().endsWith("/api/workspace/gpu-resources") && response.request().method() === "POST");
      await cloud.selectOption(selected);
      check((await response).ok(), "Resource API rejected " + selected);
      await page.waitForFunction(() => !document.body.textContent.includes("Đang lấy RAM/vCPU theo GPU và cloud…"));
      check(await cloud.inputValue() === selected, "Cloud selection reverted");
    }
    check(await form.getByRole("spinbutton", { name: "RAM tối thiểu · GB", exact: true }).inputValue() === "50", "ALL resource response did not reach form");
    check(await page.locator(".gpu-quote strong").innerText() === "$0.59/giờ GPU", "ALL quote used Community price only");
    await form.getByRole("button", { name: "Tạo bản sao", exact: true }).click();
    const name = "QA All cloud " + Date.now();
    await form.getByRole("textbox", { name: "Tên template", exact: true }).fill(name);
    const saved = page.waitForResponse(response => response.url().endsWith("/api/workspace/template") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Lưu template", exact: true }).click();
    check((await saved).ok(), "ALL template save failed");
    await page.getByRole("status").filter({ hasText: "Đã lưu template;" }).waitFor();
    const state = await (await page.request.get(base + "/api/workspace/state")).json();
    const template = state.templates.find(template => template.name === name);
    check(template?.cloudType === "ALL", "ALL template was not persisted");
    await page.reload();
    await form.getByRole("combobox", { name: "Template đã lưu", exact: true }).selectOption(template.id);
    check(await cloud.inputValue() === "ALL", "Reload lost ALL");
    await page.screenshot({ path: "output/playwright/cloud-options-desktop.png", fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile overflow at " + width);
      const adminBox = await nav.getByRole("button", { name: "Quản trị vòng", exact: true }).boundingBox();
      const peopleBox = await nav.getByRole("button", { name: "Đội & thí sinh", exact: true }).boundingBox();
      check(adminBox && peopleBox && (adminBox.y < peopleBox.y || (adminBox.y === peopleBox.y && adminBox.x < peopleBox.x)), "Mobile menu order incorrect");
    }
    await page.screenshot({ path: "output/playwright/cloud-options-mobile.png", fullPage: true });
    check(requests.some(request => request.path.endsWith("/gpu-resources") && request.body.cloudType === "ALL"), "Missing ALL resources request");
    check(requests.some(request => request.path.endsWith("/template") && request.body.cloudType === "ALL"), "Missing ALL template request");
    check(errors.length === 0, errors.join("; "));
    console.log("PASS ALL resources API, persisted template/reload, conservative quote and Admin menu order on desktop/390/320px; no provider mutations.");
  } finally {
    await page.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
    await page.goto("about:blank");
    await page.context().clearCookies();
    await page.context().unrouteAll();
  }
}
