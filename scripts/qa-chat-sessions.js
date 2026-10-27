// Playwright CLI wraps this function expression; keep it without a trailing semicolon.
async (page) => {
  const origin = new URL(page.url()).origin;
  const url = origin + "/workspace/chat?id=qa-pod";
  const sessions = new Map(),
    errors = [];
  const empty = () => ({ messages: [], inputTokens: 0, outputTokens: 0 });
  const attach = async (context) => {
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        target = new URL(req.url());
      if (target.pathname !== "/api/workspace/chat")
        return route.fulfill({ status: 409, json: { error: "QA only" } });
      const params =
        req.method() === "POST"
          ? req.postDataJSON()
          : Object.fromEntries(target.searchParams);
      const session = sessions.get(params.session) || empty();
      if (req.method() === "POST") {
        session.messages.push(
          { role: "user", content: params.content },
          { role: "assistant", content: "Trả lời: " + params.content },
        );
        session.inputTokens += 10;
        session.outputTokens += 5;
        sessions.set(params.session, session);
        return route.fulfill({ json: { session } });
      }
      return route.fulfill({
        json: {
          session,
          template: {
            sessionTokenLimit: 2000,
            inputTokenLimit: 1800,
            outputTokenLimit: 1024,
          },
          enabled: true,
          policyOpen: true,
          statusMessage: "",
          teamName: "Cùng một đội QA",
          roundTitle: "QA",
          runId: "qa-run",
        },
      });
    });
  };
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const ready = async (p) =>
    p
      .getByRole("button", { name: "Đoạn chat mới", exact: true })
      .waitFor({ state: "visible" })
      .then(() =>
        p.waitForFunction(() =>
          Array.from(document.querySelectorAll("button")).some(
            (b) => b.textContent.includes("Đoạn chat mới") && !b.disabled,
          ),
        ),
      );
  const id = async (p) =>
    p.evaluate(() => sessionStorage.getItem("arena-chat:qa-pod"));
  const send = async (p, text) => {
    await p.getByRole("textbox", { name: "Tin nhắn cho DeepSeek" }).fill(text);
    await p.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
    await p.getByText("Trả lời: " + text, { exact: true }).waitFor();
  };
  await attach(page.context());
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await ready(page);
  const first = await id(page);
  check(
    first && first !== "qa-pod",
    "First open did not allocate a random session",
  );
  await send(page, "Tin nhắn riêng máy A");
  const second = await page.context().newPage();
  await second.goto(url);
  await ready(second);
  const secondId = await id(second);
  check(first !== secondId, "Two tabs share a default conversation");
  check(
    (await second.locator(".chat-message").count()) === 0,
    "Second tab inherited history",
  );
  await send(second, "Tin nhắn riêng tab B");
  await page.reload();
  await ready(page);
  check((await id(page)) === first, "Reload changed the active session");
  await page.getByText("Tin nhắn riêng máy A", { exact: true }).waitFor();
  check(
    (await page.getByText("Tin nhắn riêng tab B", { exact: true }).count()) ===
      0,
    "Reload mixed tab histories",
  );
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("Bản nháp cũ");
  await page
    .getByRole("button", { name: "Đoạn chat mới", exact: true })
    .click();
  await ready(page);
  const next = await id(page);
  check(next !== first, "New chat did not rotate session");
  check(
    (await page.locator(".chat-message").count()) === 0,
    "New chat did not clear history",
  );
  check(
    (await page
      .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
      .inputValue()) === "",
    "New chat retained old draft",
  );
  check(!sessions.has(next), "New chat reused backend history/token ledger");
  await page.reload();
  await ready(page);
  check((await id(page)) === next, "Reload did not preserve new empty chat");
  check(
    (await page.locator(".chat-message").count()) === 0,
    "New empty chat restored old history",
  );
  await second.reload();
  await ready(second);
  check((await id(second)) === secondId, "New chat in A rotated B");
  await second.getByText("Tin nhắn riêng tab B", { exact: true }).waitFor();
  const machine = await page.context().browser().newContext();
  await attach(machine);
  const third = await machine.newPage();
  await third.goto(url);
  await ready(third);
  check(
    ![first, secondId, next].includes(await id(third)),
    "Independent browser reused session",
  );
  check(
    (await third.locator(".chat-message").count()) === 0,
    "Independent browser inherited history",
  );
  await send(page, "Phiên mới A");
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("/new");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await ready(page);
  check(
    (await id(page)) !== next &&
      (await page.locator(".chat-message").count()) === 0,
    "/new failed",
  );
  check(errors.length === 0, errors.join("\n"));
  await machine.close();
  await second.close();
  return {
    passed: true,
    separateTabs: true,
    separateMachines: true,
    reloadResumes: true,
    newChatEmpty: true,
    newChatReloadResumes: true,
    otherTabUnaffected: true,
    slashNew: true,
    providerCalls: 0,
  };
}
