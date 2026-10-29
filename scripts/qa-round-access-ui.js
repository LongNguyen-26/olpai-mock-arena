/** Run via playwright-cli run-code --filename after serve-round-access-qa.ts. */
async (page) => {
  const base = "http://localhost:3016",
    shots = "output/playwright/round-access-";
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const errors = [],
    responses = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(base + "/api/"))
      responses.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto(base + "/login");
  await page
    .getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true })
    .fill("qa_round_admin");
  await page
    .getByRole("textbox", { name: "Mật khẩu", exact: true })
    .fill("Arena-Round-QA-Only-2026!");
  await page
    .locator("form")
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .click();
  await page.waitForURL(base + "/");
  const catalog = await (await page.request.get(base + "/api/arena")).json();
  const rid = catalog.rounds[0].id;
  check(
    catalog.rounds[0].title.startsWith("QA ·"),
    "Only QA fixture may be changed",
  );
  const snap = async () =>
    await (await page.request.get(base + "/api/arena?round=" + rid)).json();
  async function control(value, expected = 200) {
    const current = await snap();
    const body = {
      ...value,
      runId: current.contest.id,
      revision: current.contest.revision || 0,
      requestId: crypto.randomUUID(),
    };
    const response = await page.request.post(
      base + "/api/admin/control?round=" + rid,
      { headers: { Origin: base }, data: body },
    );
    check(
      response.status() === expected,
      "Control " +
        value.action +
        " -> " +
        response.status() +
        " " +
        JSON.stringify(await response.json()),
    );
    return body;
  }
  async function visit(section) {
    await page.goto(base + "/?round=" + rid + "#" + section);
    await page
      .getByRole("heading", {
        level: 1,
        name: section === "admin" ? "Quản trị vòng luyện" : "Tổng quan",
        exact: true,
      })
      .waitFor();
    await page.locator(".round-access-controls").waitFor();
  }
  await page.request.post(base + "/api/admin/control?round=" + rid, {
    headers: { Origin: base },
    data: { action: "reset" },
  });
  await control({
    action: "private-policy",
    lockPublic: true,
    revokeChatbot: true,
  });
  await visit("admin");
  check(
    await page.getByLabel("Khóa nộp public", { exact: true }).isChecked(),
    "Default public lock",
  );
  check(
    await page.getByLabel("Thu hồi quyền chatbot", { exact: true }).isChecked(),
    "Default chatbot revoke",
  );
  await page.getByRole("button", { name: "Bắt đầu ngay", exact: true }).click();
  await page
    .getByRole("button", { name: "Điều chỉnh thời gian", exact: true })
    .waitFor();
  let current = await snap();
  const run = current.contest.id,
    start = current.contest.startAt;
  const originalEnd =
    current.contest.startAt +
    (current.contest.publicSeconds + current.contest.privateSeconds) * 1000;
  await page
    .getByRole("button", { name: "Điều chỉnh thời gian", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  check(
    (await dialog.innerText()).includes("Lịch hiện tại"),
    "Timing preview missing",
  );
  await page.screenshot({ path: shots + "timing-desktop.png", fullPage: true });
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  current = await snap();
  check(
    current.contest.id === run && current.contest.startAt === start,
    "Timing changed run/start",
  );
  check(
    current.contest.endAt === originalEnd,
    "Default timing lost seconds or milliseconds",
  );
  await page
    .getByRole("button", { name: "Chuyển sang private ngay", exact: true })
    .click();
  await dialog.waitFor();
  check(
    await dialog.getByLabel("Khóa nộp public", { exact: true }).isChecked(),
    "Private default public lock missing",
  );
  check(
    await dialog
      .getByLabel("Thu hồi quyền chatbot", { exact: true })
      .isChecked(),
    "Private default chatbot revoke missing",
  );
  await dialog.getByLabel("Khóa nộp public", { exact: true }).uncheck();
  await dialog.getByLabel("Thu hồi quyền chatbot", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  current = await snap();
  check(current.phase === "private", "Early private failed");
  check(
    current.contest.endAt === originalEnd,
    "Early private must preserve original end",
  );
  const marker = current.contest.privateStartedAt;
  for (const visible of [false, true]) {
    const checkbox = page.getByRole("checkbox", {
      name: "Hiện private submission",
      exact: true,
    });
    const mutation = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/control") &&
        r.request().postDataJSON()?.action === "submission-access",
    );
    await checkbox.click();
    check((await mutation).ok(), "Visibility mutation failed");
    await page
      .getByRole("checkbox", { name: "Hiện private submission", exact: true })
      .waitFor();
    await page.waitForFunction(
      (v) =>
        document.querySelector('input[aria-label="Hiện private submission"]')
          .checked === v,
      visible,
    );
  }
  check(
    (await snap()).contest.privateStartedAt === marker,
    "Visibility replayed private transition",
  );
  await page
    .getByRole("button", { name: "Cấp / hẹn giờ", exact: true })
    .click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  check(
    (await snap()).contest.chatbotAllowed === true,
    "Private chatbot grant failed",
  );
  await page.screenshot({
    path: shots + "private-desktop.png",
    fullPage: true,
  });
  const studentContext = await page.context().browser().newContext(),
    student = await studentContext.newPage();
  student.on("pageerror", (e) => errors.push(e.message));
  await student.goto(base + "/login");
  await student
    .getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true })
    .fill("round-student@example.test");
  await student
    .getByRole("textbox", { name: "Mật khẩu", exact: true })
    .fill("Arena-Round-QA-Only-2026!");
  await student
    .locator("form")
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .click();
  await student.waitForURL(base + "/");
  await student.goto(base + "/?round=" + rid + "#submit");
  await student.locator(".submission-split-picker").waitFor();
  check(
    (await student.locator(".submission-split-picker option").count()) === 2,
    "Both submission choices should exist",
  );
  const unauthorized = await student.request.post(
    base + "/api/admin/control?round=" + rid,
    {
      headers: { Origin: base },
      data: {
        action: "notebook-access",
        enabled: true,
        runId: run,
        revision: current.contest.revision || 0,
        requestId: crypto.randomUUID(),
      },
    },
  );
  check(unauthorized.status() === 403, "Student changed admin policy");
  await control({
    action: "submission-access",
    split: "private",
    visible: false,
    enabled: true,
  });
  await student.reload();
  await student.locator(".submission-split-picker").waitFor();
  check(
    (await student.locator(".submission-split-picker option").count()) === 1,
    "Hidden private still listed",
  );
  const blocked = await student.request.post(
    base + "/api/submit?round=" + rid,
    {
      headers: { Origin: base },
      multipart: {
        task: "1",
        split: "private",
        nonce: crypto.randomUUID(),
        file: {
          name: "empty.csv",
          mimeType: "text/csv",
          buffer: Buffer.alloc(0),
        },
      },
    },
  );
  check(blocked.status() === 409, "Hidden private accepted HTTP upload");
  await control({
    action: "submission-access",
    split: "private",
    visible: true,
    enabled: true,
  });
  const invalid = await student.request.post(
    base + "/api/submit?round=" + rid,
    {
      headers: { Origin: base },
      multipart: {
        task: "1",
        split: "private",
        nonce: crypto.randomUUID(),
        file: {
          name: "empty.csv",
          mimeType: "text/csv",
          buffer: Buffer.alloc(0),
        },
      },
    },
  );
  check(
    invalid.status() === 422 && !!(await invalid.json()).id,
    "Open private did not preserve invalid submission history",
  );
  await page.request.post(base + "/api/admin/control?round=" + rid, {
    headers: { Origin: base },
    data: { action: "finish" },
  });
  await visit("admin");
  await page
    .getByRole("button", { name: "Mở luyện tập tiếp", exact: true })
    .click();
  await dialog.waitFor();
  check(
    !(await dialog
      .getByLabel("Cấp quyền chatbot", { exact: true })
      .isChecked()),
    "Practice chatbot should default off",
  );
  await dialog.getByLabel("Cấp quyền chatbot", { exact: true }).check();
  await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  current = await snap();
  check(
    current.phase === "practice" && current.contest.id === run,
    "Practice changed run or phase failed",
  );
  await page.screenshot({
    path: shots + "practice-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: shots + "practice-mobile.png",
    fullPage: true,
  });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Admin mobile horizontal overflow",
  );
  await page
    .getByRole("button", { name: "Điều chỉnh thời gian", exact: true })
    .click();
  await dialog.waitFor();
  await page.screenshot({ path: shots + "timing-mobile.png", fullPage: true });
  check(
    await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    "Mobile dialog overflow",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await student.setViewportSize({ width: 390, height: 844 });
  await student.reload();
  await student.locator(".submission-split-picker").waitFor();
  check(
    (await student.locator(".submission-split-picker option").count()) === 2,
    "Practice should show both splits",
  );
  check(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Student mobile horizontal overflow",
  );
  await student.screenshot({
    path: shots + "student-mobile.png",
    fullPage: true,
  });
  // Automatic private entry without an admin page polling or clicking a transition.
  await control({ action: "practice-close" });
  await page.request.post(base + "/api/admin/control?round=" + rid, {
    headers: { Origin: base },
    data: { action: "reset" },
  });
  await control({
    action: "private-policy",
    lockPublic: true,
    revokeChatbot: true,
  });
  await page.request.post(base + "/api/admin/control?round=" + rid, {
    headers: { Origin: base },
    data: { action: "start" },
  });
  let serverTime = (await snap()).serverNow;
  await control({
    action: "timing",
    privateAt: serverTime + 5000,
    endAt: serverTime + 60000,
  });
  await page.waitForTimeout(6000);
  current = await snap();
  check(
    current.phase === "private" &&
      current.contest.chatbotAllowed === false &&
      current.contest.submissionAccess.public.enabled === false,
    "Automatic transition did not apply saved policy",
  );
  serverTime = (await snap()).serverNow;
  await control({
    action: "chatbot-access",
    enabled: true,
    until: serverTime + 5000,
  });
  await page.waitForTimeout(6000);
  // The effective gate is covered by real Redis/Lua tests; a grant remains configured but expired.
  await visit("admin");
  check(
    (await page.locator(".round-access-table").innerText()).includes(
      "Đang khóa",
    ),
    "Expired grant state missing",
  );
  await student.request.post(base + "/api/auth/logout", {
    headers: { Origin: base },
    data: {},
  });
  await studentContext.close();
  await page.request.post(base + "/api/auth/logout", {
    headers: { Origin: base },
    data: {},
  });
  await page.context().clearCookies();
  check(errors.length === 0, errors.join("\n"));
  check(!responses.some((r) => r.status >= 500), "Unexpected server error");
  console.log(
    "PASS UI + real HTTP/Redis: timing, exact end preservation, private options, visibility, chatbot regrant, role checks, hidden submission 409, invalid submission 422/history, same-run practice, automatic private, desktop/mobile dialogs and no page/server errors.",
  );
}
