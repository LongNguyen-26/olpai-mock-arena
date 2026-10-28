// Requires qa-submission-storage.ts fixture and local server on port 3011.
async (page) => {
  const base = "http://localhost:3011",
    errors = [];
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().unrouteAll();
  const login = await page.request.post(base + "/api/auth/login", {
    headers: { Origin: base },
    data: { username: "qa-admin", password: "QA-Submission-Only-2026!" },
  });
  check(login.ok(), "QA login failed");
  try {
    const state = await (await page.request.get(base + "/api/arena")).json();
    const round = state.rounds[0].id;
    await page.setViewportSize({ width: 1600, height: 1050 });
    await page.goto(base + "/?round=" + round + "#submit");
    await page
      .getByRole("combobox", { name: "Tác vụ", exact: true })
      .selectOption("1");
    await page
      .locator('input[type="file"]')
      .setInputFiles(
        "C:/CS_Major/Contest_2026/Olympic_AI/statements/Arena_02/web_ready/qa/synthetic-1-public.csv",
      );
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/submit?") && r.request().method() === "POST",
    );
    await page
      .locator("form")
      .getByRole("button", { name: "Nộp bài", exact: true })
      .click();
    check((await response).ok(), "Submission UI returned error");
    await page
      .getByRole("heading", { name: "Chấm bài thành công", exact: true })
      .waitFor();
    check(
      (await page.locator(".result-score").innerText()).includes("19.92"),
      "Wrong result score",
    );
    await page.screenshot({
      path: "output/playwright/submission-fixed-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Submission mobile overflow",
    );
    await page.screenshot({
      path: "output/playwright/submission-fixed-mobile.png",
      fullPage: true,
    });
    check(errors.length === 0, errors.join("\n"));
    return {
      passed: true,
      realHttpSubmission: true,
      desktop: true,
      mobile: true,
      productionWrites: 0,
    };
  } finally {
    await page.request.post(base + "/api/auth/logout", {
      headers: { Origin: base },
    });
    await page.context().clearCookies();
  }
};
