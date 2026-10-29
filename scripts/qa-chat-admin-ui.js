// Playwright CLI callback. Real isolated auth/template edits; all provider mutations mocked.
async (page) => {
  const base = "http://localhost:3010",
    errors = [],
    allocations = [];
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  page.on("pageerror", (e) => errors.push(e.message));
  const attach = async (context) => {
    await context.route("**/api/workspace/prices", (r) =>
      r.fulfill({
        json: {
          fetchedAt: Date.now(),
          gpus: [
            {
              id: "NVIDIA A40",
              name: "A40",
              memory: 48,
              price: { secure: 0.7, community: 0.59 },
            },
            {
              id: "NVIDIA RTX A5000",
              name: "A5000",
              memory: 24,
              price: { secure: 0.3, community: 0.27 },
            },
          ],
        },
      }),
    );
    await context.route("**/api/workspace/sync", (r) =>
      r.fulfill({ json: {} }),
    );
    await context.route("**/api/workspace/group/deploy", (r) => {
      allocations.push(r.request().postDataJSON());
      return r.fulfill({ json: { status: "provisioning" } });
    });
    await context.route("**/api/workspace/control", (r) =>
      r.fulfill({
        status: 409,
        json: { error: "QA does not control real Pods" },
      }),
    );
  };
  const login = async (p, username) => {
    await p.goto(base + "/login");
    await p
      .getByRole("textbox", { name: "Email hoặc tên đăng nhập", exact: true })
      .fill(username);
    await p
      .getByRole("textbox", { name: "Mật khẩu", exact: true })
      .fill("Arena-GPU-QA-Only-2026!");
    await p
      .locator("form")
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .click();
    await p.waitForURL(base + "/");
  };
  const openWorkspace = async (p) => {
    const arena = await (await p.request.get(base + "/api/arena")).json();
    await p.goto(base + "/?round=" + arena.rounds[0].id + "#workspace");
    await p
      .getByRole("heading", { name: "Dịch vụ trên Pod", exact: true })
      .waitFor();
    await p
      .locator(".gpu-choice-services button")
      .filter({ hasText: "Chỉ Chatbot" })
      .click();
    await p
      .locator(".gpu-template-panel")
      .getByRole("spinbutton", {
        name: "Tổng token tối đa / phiên",
        exact: true,
      })
      .waitFor();
  };
  await page.context().unrouteAll();
  await page.context().clearCookies();
  await attach(page.context());
  await login(page, "qa_gpu_admin");
  await openWorkspace(page);
  await page.setViewportSize({ width: 1600, height: 1050 });
  const form = page.locator(".gpu-template-panel"),
    total = form.getByRole("spinbutton", {
      name: "Tổng token tối đa / phiên",
      exact: true,
    });
  await total.fill("3000");
  const mode = form.getByRole("combobox", {
    name: "Cách áp dụng giới hạn token",
    exact: true,
  });
  await mode.selectOption("session");
  check(
    (await total.inputValue()) === "3000",
    "Session mode hid/reset total cap",
  );
  await mode.selectOption("turn");
  check((await total.inputValue()) === "3000", "Turn mode hid/reset total cap");
  await form.getByRole("button", { name: "Lưu template", exact: true }).click();
  await form
    .getByRole("button", { name: "Xác nhận ghi đè", exact: true })
    .click();
  await page
    .getByText(
      "Đã lưu template; giới hạn chatbot được cập nhật theo cấu hình mới.",
      { exact: true },
    )
    .waitFor();
  const machine = await page.context().browser().newContext();
  await attach(machine);
  const other = await machine.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  await login(other, "qa_gpu_admin2");
  await openWorkspace(other);
  const otherForm = other.locator(".gpu-template-panel");
  check(
    (await otherForm
      .getByRole("spinbutton", {
        name: "Tổng token tối đa / phiên",
        exact: true,
      })
      .inputValue()) === "3000",
    "Admin 2 cannot see shared edit",
  );
  await otherForm
    .getByRole("spinbutton", { name: "Tổng token tối đa / phiên", exact: true })
    .fill("2900");
  await otherForm
    .getByRole("button", { name: "Lưu template", exact: true })
    .click();
  await otherForm
    .getByRole("button", { name: "Xác nhận ghi đè", exact: true })
    .click();
  await other
    .getByText(
      "Đã lưu template; giới hạn chatbot được cập nhật theo cấu hình mới.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".gpu-template-panel label")).some(
      (l) =>
        l.textContent.includes("Tổng token tối đa") &&
        l.querySelector("input")?.value === "2900",
    ),
  );
  const deploy = page.locator(".gpu-deploy-panel");
  await deploy.getByRole("button", { name: /Chung tất cả đội/ }).click();
  const groups = deploy.getByRole("combobox", {
    name: "Nhóm Chatbot",
    exact: true,
  });
  const groupId = await groups.locator("option").nth(1).getAttribute("value");
  check(!!groupId, "Existing group missing");
  await groups.selectOption(groupId);
  const allocationDone = page.waitForResponse((r) =>
    r.url().endsWith("/api/workspace/group/deploy"),
  );
  await deploy
    .getByRole("button", { name: "Thêm một Pod vào nhóm", exact: true })
    .click();
  await allocationDone;
  await page.getByText("Đã gửi yêu cầu cấp Pod.", { exact: true }).waitFor();
  check(
    allocations.length === 1 &&
      allocations[0].groupId === groupId &&
      /^[0-9a-f-]{36}$/.test(allocations[0].requestId),
    "Group allocation payload is wrong",
  );
  check(
    (await page.getByRole("region", { name: "Điều phối Chatbot" }).count()) > 0,
    "Admin worker monitoring is absent",
  );
  await page.screenshot({
    path: "output/playwright/chat-admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Admin mobile overflow",
  );
  await page.screenshot({
    path: "output/playwright/chat-admin-mobile.png",
    fullPage: true,
  });
  await form.screenshot({
    path: "output/playwright/chat-admin-mobile-template.png",
  });
  await page.request.post(base + "/api/auth/logout", {
    headers: { Origin: base },
    data: {},
  });
  await other.request.post(base + "/api/auth/logout", {
    headers: { Origin: base },
    data: {},
  });
  await machine.close();
  await page.context().clearCookies();
  await page.context().unrouteAll();
  check(errors.length === 0, errors.join("\n"));
  return {
    passed: true,
    sharedAdminEdits: true,
    editableTotalInBothModes: true,
    groupedAllocation: true,
    desktopAndMobile: true,
    paidPodsCreated: 0,
  };
};
