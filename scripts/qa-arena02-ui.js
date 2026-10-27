/** Run with Playwright CLI against the isolated, logged-in Arena 02 QA fixture. */
async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const round = "00000000-0000-4000-8000-000000000002";
  const root = "http://localhost:3005/?round=" + round;
  const shots = "output/playwright/arena02-";
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const visit = async (section) => {
    await page.goto(root + "#" + section);
    await page
      .getByRole("heading", {
        name: {
          overview: "Tổng quan",
          statement: "Đề thi",
          data: "Dữ liệu",
          submit: "Nộp bài",
          leaderboard: "Bảng xếp hạng",
        }[section],
        exact: true,
        level: 1,
      })
      .waitFor();
    await page.getByRole("navigation", { name: "Điều hướng chính" }).waitFor();
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit("overview");
  await page
    .getByRole("heading", { name: "Máy bơm đang hỏng gì?", exact: true })
    .waitFor();
  check(
    (await page.locator(".task-card").count()) === 3,
    "Expected three overview cards",
  );
  await page.screenshot({
    path: shots + "overview-desktop.png",
    fullPage: true,
  });
  await visit("statement");
  await page.getByRole("button", { name: "Tác vụ 03", exact: true }).click();
  await page.getByRole("heading", { name: /Tác vụ 3 - Máy bơm/ }).waitFor();
  check(
    !(await page.locator(".prose").innerText()).includes(
      "Dành cho ban tổ chức",
    ),
    "Organizer section leaked",
  );
  await visit("data");
  await page
    .getByRole("heading", { name: "Tac_vu_3.zip", exact: true })
    .waitFor();
  check(
    (await page.locator(".asset-card").count()) === 6,
    "Expected six public assets",
  );
  check(
    !(await page.locator("main").innerText()).includes("_private.zip"),
    "Private filename visible",
  );
  await page.screenshot({ path: shots + "data-desktop.png", fullPage: true });
  await visit("submit");
  await page.getByRole("combobox", { name: "Tác vụ", exact: true }).selectOption("3");
  await page.getByText("id,label", { exact: true }).waitFor();
  check(
    (await page.locator(".submit-help").innerText()).includes("tối đa 100"),
    "Wrong total maximum",
  );
  await page
    .locator("input[type=file]")
    .setInputFiles(
      "C:/CS_Major/Contest_2026/Olympic_AI/statements/Arena_02/web_ready/qa/jupyter_layout/data/public/Tac_vu_3/submission_public.csv",
    );
  await page
    .locator("form")
    .getByRole("button", { name: "Nộp bài", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Chấm bài thành công", exact: true })
    .waitFor();
  check(
    (await page.locator(".result-score").innerText()).includes("/ 35 điểm"),
    "Wrong task maximum",
  );
  await page.screenshot({
    path: shots + "submit3-desktop.png",
    fullPage: true,
  });
  await visit("leaderboard");
  await page
    .getByRole("columnheader", { name: "Tác vụ 03", exact: true })
    .waitFor();
  check(
    (await page.locator(".leaderboard thead th").count()) === 7,
    "Expected third-task board column",
  );
  await page.screenshot({ path: shots + "board-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const section of ["data", "statement", "submit", "leaderboard"]) {
    await visit(section);
    if (section === "statement") {
      await page
        .getByRole("button", { name: "Tác vụ 03", exact: true })
        .click();
      await page.getByRole("heading", { name: /Tác vụ 3 - Máy bơm/ }).waitFor();
    }
    if (section === "submit")
      await page.getByRole("combobox", { name: "Tác vụ", exact: true }).selectOption("3");
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      `Page overflow: ${section}`,
    );
    await page.screenshot({
      path: shots + section + "-mobile.png",
      fullPage: true,
    });
  }
  check(errors.length === 0, "Browser errors: " + errors.join("; "));
  console.log(
    "PASS desktop/mobile: three tasks, third statement, six public assets, actual third-task upload/result out of 35, seven-column leaderboard, total 100 and no page overflow/errors.",
  );
}
