// Playwright CLI callback: real rendering, mock chat/provider; no GPU calls.
async (page) => {
  const base = "http://localhost:3010",
    errors = [],
    sessions = new Map(),
    attempts = [],
    released = new Set();
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const empty = () => ({ messages: [], inputTokens: 0, outputTokens: 0 });
  let drop = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().route("**/api/workspace/chat**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const p =
      req.method() === "POST"
        ? req.postDataJSON()
        : Object.fromEntries(url.searchParams);
    const session = sessions.get(p.session) ?? empty();
    if (req.method() === "POST") {
      attempts.push(p);
      if (drop) {
        drop = false;
        return route.abort("failed");
      }
      if (
        session.pending?.requestId !== p.requestId &&
        session.lastRequestId !== p.requestId
      ) {
        session.messages.push({ role: "user", content: p.content });
        session.pending = { requestId: p.requestId, reserved: 0 };
      }
      sessions.set(p.session, session);
      return route.fulfill({
        status: 202,
        json: { requestId: p.requestId, session },
      });
    }
    if (session.pending && released.has(p.session)) {
      session.lastRequestId = session.pending.requestId;
      delete session.pending;
      session.messages.push({
        role: "assistant",
        content: "Câu trả lời đã hoàn tất.",
      });
      session.inputTokens += 20;
      session.outputTokens += 5;
    }
    return route.fulfill({
      json: {
        session,
        enabled: true,
        policyOpen: true,
        runId: "qa-run",
        template: {
          tokenLimitMode: "turn",
          sessionTokenLimit: 2000,
          inputTokenLimit: 1800,
          outputTokenLimit: 1024,
        },
        teamName: "Đội QA",
        roundTitle: "Kiểm tra nhóm Chatbot",
        statusMessage: "",
      },
    });
  });
  const url = base + "/workspace/chat?groupId=qa-group";
  const sessionId = (p) =>
    p.evaluate(() => sessionStorage.getItem("arena-chat:group:qa-group"));
  const ready = async (p) => {
    await p.getByRole("textbox", { name: "Tin nhắn cho DeepSeek" }).waitFor();
    await p.waitForFunction(
      () => !document.querySelector(".chat-header-actions button")?.disabled,
    );
  };
  const noProgress = async (p) => {
    check(
      !/đang chờ|đang chạy|đang suy luận|hàng đợi|vị trí|hủy prompt/i.test(
        await p.locator("main").innerText(),
      ),
      "Request progress leaked to contestant",
    );
    check(
      (await p
        .locator(".chat-thinking,.chat-thinking-dots,[aria-busy=true]")
        .count()) === 0,
      "Inference animation is visible",
    );
    check(
      (await p.getByRole("button", { name: /hủy|cancel/i }).count()) === 0,
      "Contestant can cancel a prompt",
    );
  };
  await page.goto(url);
  await ready(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  const first = await sessionId(page);
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("Prompt đầu tiên");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await page.getByText("Prompt đầu tiên", { exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("Bản nháp cần giữ");
  check(
    await page
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .isDisabled(),
    "Pending session accepted another message",
  );
  check(
    await page
      .getByRole("button", { name: "Đoạn chat mới", exact: true })
      .isDisabled(),
    "Pending session can reset",
  );
  await noProgress(page);
  check(
    (await page
      .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
      .inputValue()) === "Bản nháp cần giữ",
    "Draft lost",
  );
  await page.screenshot({
    path: "output/playwright/chat-queue-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByText("Prompt đầu tiên", { exact: true }).waitFor();
  check(
    (await sessionId(page)) === first,
    "Refresh changed group conversation",
  );
  check(
    (await page.locator(".chat-message.user").count()) === 1,
    "Refresh duplicated the prompt",
  );
  await noProgress(page);
  const second = await page.context().newPage();
  await second.goto(url);
  await ready(second);
  check((await sessionId(second)) !== first, "Two tabs share a session");
  check(
    (await second.locator(".chat-message").count()) === 0,
    "Second tab inherited messages",
  );
  released.add(first);
  await page.getByText("Câu trả lời đã hoàn tất.", { exact: true }).waitFor();
  await ready(page);
  check(
    (await page.locator(".chat-message.assistant").count()) === 1,
    "Response duplicated",
  );
  await page
    .getByRole("button", { name: "Đoạn chat mới", exact: true })
    .click();
  await ready(page);
  // Lose an enqueue before acceptance, then reload: the same outbox ID is retried.
  drop = true;
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("Prompt mất ACK");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await page.waitForFunction(() =>
    Object.keys(sessionStorage).some((k) => k.startsWith("arena-chat-outbox:")),
  );
  await page.reload();
  await page.getByText("Prompt mất ACK", { exact: true }).waitFor();
  await page.waitForTimeout(2500);
  const retry = attempts.filter((p) => p.content === "Prompt mất ACK");
  check(
    retry.length >= 2 && new Set(retry.map((p) => p.requestId)).size === 1,
    "Lost enqueue generated another request ID",
  );
  check(
    (await page.locator(".chat-message.user").count()) === 1,
    "Outbox retry duplicated prompt",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noProgress(page);
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Mobile overflow",
  );
  await page.screenshot({
    path: "output/playwright/chat-queue-mobile.png",
    fullPage: true,
  });
  released.add(await sessionId(page));
  await page.getByText("Câu trả lời đã hoàn tất.", { exact: true }).waitFor();
  const context = await page.context().browser().newContext();
  const third = await context.newPage();
  await context.route("**/api/workspace/chat**", (r) =>
    r.fulfill({
      json: {
        session: empty(),
        enabled: true,
        policyOpen: true,
        runId: "qa-run",
        template: {
          sessionTokenLimit: 2000,
          inputTokenLimit: 1800,
          outputTokenLimit: 1024,
        },
        teamName: "Đội QA",
        roundTitle: "QA",
      },
    }),
  );
  await third.goto(url);
  await ready(third);
  check(
    ![first, await sessionId(second), await sessionId(page)].includes(
      await sessionId(third),
    ),
    "Separate browser reused a session",
  );
  await context.close();
  await second.close();
  await page.context().unrouteAll();
  check(errors.length === 0, errors.join("\n"));
  return {
    passed: true,
    noStudentProgress: true,
    noCancellation: true,
    refresh: true,
    sameIdOutboxRetry: true,
    separateTabsAndBrowsers: true,
    desktopAndMobile: true,
    providerCalls: 0,
  };
};
