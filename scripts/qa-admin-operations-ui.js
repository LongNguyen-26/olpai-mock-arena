// Playwright CLI callback: real isolated QA accounts/Redis; GPU mutations mocked.
async (page) => {
  const base = "http://localhost:3010", errors = [], retries = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const contexts = [page.context()];
  const login = async (p, username) => {
    await p.goto(base + "/login");
    await p.getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true }).fill(username);
    await p.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill("Arena-GPU-QA-Only-2026!");
    await p.locator("form").getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.waitForURL(base + "/");
  };
  await page.context().clearCookies();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().route("**/api/workspace/sync", (r) => r.fulfill({ json: {} }));
  await page.context().route("**/api/workspace/prices", (r) => r.fulfill({ json: { fetchedAt: Date.now(), gpus: [{ id: "NVIDIA A40", name: "A40", memory: 48, price: { secure: .7, community: .59 } }] } }));
  await page.context().route("**/api/workspace/retry", (r) => {
    retries.push(r.request().postDataJSON());
    if (retries.length === 1) return r.abort("failed");
    return r.fulfill({ json: { status: "reconciling", id: retries[1].requestId } });
  });
  try {
    await login(page, "qa_ops_admin");
    const catalog = await (await page.request.get(base + "/api/arena")).json();
    const first = catalog.rounds.find((r) => r.title === "Vòng QA đã duyệt").id;
    const second = catalog.rounds.find((r) => r.title === "Vòng QA thứ hai").id;
    const self = (await (await page.request.get(base + "/api/me")).json()).user;
    const protectedDelete = await page.request.post(base + "/api/admin/roster", { headers: { Origin: base }, data: { kind: "contestant", id: self.id } });
    check(protectedDelete.status() === 403, "Admin account was deletable");
    const blockedOrigin = await page.request.post(base + "/api/admin/roster", { headers: { Origin: "https://untrusted.example" }, data: { kind: "team", id: self.id } });
    check(blockedOrigin.status() === 403, "Delete endpoint accepted wrong Origin");
    await page.goto(base + "/?round=" + first + "#workspace");
    const form = page.locator(".gpu-deploy-panel");
    const team = form.getByRole("combobox", { name: "Đội thi", exact: true });
    await team.locator("option").filter({ hasText: "Đội QA đã duyệt" }).waitFor({ state: "attached" });
    check((await team.locator("option").allTextContents()).length === 2, "GPU dropdown includes unapproved teams");
    check(!(await team.textContent()).includes("Đội QA chờ duyệt"), "Pending team is visible for first round");
    const approved = await team.locator("option").nth(1).getAttribute("value");
    await team.selectOption(approved);
    const rounds = form.getByRole("combobox", { name: /Vòng luyện áp dụng/ });
    await rounds.selectOption(second);
    await team.locator("option").filter({ hasText: "Đội QA chờ duyệt" }).waitFor({ state: "attached" });
    check(await team.inputValue() === "", "Round change retained an invalid team");
    check(!(await team.textContent()).includes("Đội QA đã duyệt"), "Previous-round team leaked into second round");
    await rounds.selectOption(first);
    await team.locator("option").filter({ hasText: "Đội QA đã duyệt" }).waitFor({ state: "attached" });
    const retry = page.getByRole("button", { name: "Thử cấp lại GPU", exact: true });
    await retry.click();
    await page.locator(".gpu-workspace .alert.error").waitFor();
    const retryResponse = page.waitForResponse((r) => r.url().endsWith("/api/workspace/retry") && r.status() === 200);
    await retry.click(); await retryResponse;
    check(retries.length === 2 && retries[0].requestId === retries[1].requestId, "Capacity retry changed ID after connection failure");
    check(/^[a-f0-9-]{36}$/.test(retries[0].requestId), "Retry request ID missing");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await form.screenshot({ path: "output/playwright/admin-approved-teams-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "GPU form mobile overflow");
    await form.screenshot({ path: "output/playwright/admin-approved-teams-mobile.png" });
    const victimContext = await page.context().browser().newContext(); contexts.push(victimContext);
    const victim = await victimContext.newPage(); await login(victim, "qa_ops_ui_delete");
    await page.goto(base + "/#people");
    const roster = page.locator(".roster-panel");
    await roster.getByRole("button", { name: /Thí sinh \(/ }).click();
    const search = roster.getByRole("textbox", { name: "Tìm đội hoặc thí sinh", exact: true });
    await search.fill("Thí sinh UI cần xóa");
    await roster.getByRole("button", { name: "Xóa thí sinh", exact: true }).click();
    await roster.getByRole("alertdialog", { name: "Xác nhận xóa" }).waitFor();
    await roster.getByRole("button", { name: "Giữ lại", exact: true }).click();
    check((await victim.request.get(base + "/api/arena")).status() === 200, "Cancel deleted the account");
    await roster.getByRole("button", { name: "Xóa thí sinh", exact: true }).click();
    const deleted = page.waitForResponse((r) => r.url().endsWith("/api/admin/roster") && r.request().method() === "POST" && r.status() === 200);
    await roster.getByRole("button", { name: "Xác nhận xóa", exact: true }).click(); await deleted;
    await roster.getByText("Đã xóa mục đã chọn.", { exact: true }).waitFor();
    check((await victim.request.get(base + "/api/arena")).status() === 401, "Deleted contestant session remains usable");
    await search.fill(""); await roster.getByRole("button", { name: /Đội \(/ }).click();
    await search.fill("Đội UI cần xóa");
    await roster.getByRole("button", { name: "Xóa đội", exact: true }).click();
    const teamDeleted = page.waitForResponse((r) => r.url().endsWith("/api/admin/roster") && r.request().method() === "POST" && r.status() === 200);
    await roster.getByRole("button", { name: "Xác nhận xóa", exact: true }).click(); await teamDeleted;
    await roster.getByText("Không có kết quả.", { exact: true }).waitFor();
    await search.fill("");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await roster.screenshot({ path: "output/playwright/admin-roster-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Roster mobile overflow");
    await roster.screenshot({ path: "output/playwright/admin-roster-mobile.png" });
    const memberContext = await page.context().browser().newContext(); contexts.push(memberContext);
    const member = await memberContext.newPage(); await login(member, "qa_ops_member");
    check((await member.request.get(base + "/api/admin/roster")).status() === 403, "Contestant can list all users");
    check((await member.request.post(base + "/api/admin/roster", { headers: { Origin: base }, data: { kind: "team", id: approved } })).status() === 403, "Contestant can delete a team");
    check((await member.request.get(base + "/api/workspace/teams?round=" + first)).status() === 403, "Contestant can access provisioning roster");
    const otherContext = await page.context().browser().newContext(); contexts.push(otherContext);
    const other = await otherContext.newPage(); await login(other, "qa_ops_admin2");
    check((await other.request.get(base + "/api/admin/roster")).status() === 200, "Additional admin cannot manage roster");
    check(errors.length === 0, errors.join("\n"));
    return { passed: true, actualQaDeletion: true, deletedSessionRevoked: true, teamsFilteredByRound: true, retryKeepsId: true, roles: true, desktopAndMobile: true, realGpuCalls: 0 };
  } finally {
    for (const context of contexts) {
      for (const p of context.pages()) await p.goto("about:blank").catch(() => {});
      await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } }).catch(() => {});
      await context.clearCookies(); await context.unrouteAll();
      if (context !== page.context()) await context.close();
    }
  }
}
