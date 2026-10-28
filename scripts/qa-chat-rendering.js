// Playwright CLI callback: mocked chat provider, no real model or Pod calls.
async (page) => {
  const base = new URL(page.url()).origin,
    sessions = new Map(),
    errors = [];
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.context().unrouteAll();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const markdown =
    String.raw`Công thức F1:

\[ F1 = \frac{2 \times \text{số token chung}}{\text{số token dự đoán} + \text{số token đáp án}} \]

Trong dòng: \(x^2 + y^2 = z^2\), $a+b$.

[ F1 = \frac{2}{3} ]

` +
    "```python\nprint('Xin chào')\nformula = r'\\[x^2\\]'\n```\n\n```\nno_language = True\n```";
  const empty = () => ({
    messages: [{ role: "assistant", content: markdown }],
    inputTokens: 40,
    outputTokens: 60,
  });
  let posts = 0;
  await page.context().route("**/api/workspace/chat**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    const params =
      r.method() === "POST"
        ? r.postDataJSON()
        : Object.fromEntries(url.searchParams);
    const session = sessions.get(params.session) ?? empty();
    sessions.set(params.session, session);
    if (r.method() === "POST") {
      posts++;
      session.messages.push({ role: "user", content: params.content });
      session.inputTokens = 1940;
      session.exhausted = {
        reason: "input",
        promptTokens: 1801,
        message:
          "Input vượt giới hạn 1800 token. Tin nhắn đã được lưu; phiên đã hết ngân sách token. Dùng /new hoặc Đoạn chat mới để tiếp tục.",
      };
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
        teamName: "Đội QA",
        roundTitle: "Kiểm tra chatbot",
      },
    });
  });
  await page.goto(base + "/workspace/chat?id=qa-render");
  await page.locator(".katex").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  check(
    (await page.locator(".katex").count()) === 4,
    "Math delimiters did not all render",
  );
  check((await page.locator(".katex-error").count()) === 0, "KaTeX errors");
  check(
    (await page
      .getByRole("button", { name: "Sao chép mã", exact: true })
      .count()) === 2,
    "Missing code copy controls",
  );
  await page
    .getByRole("button", { name: "Sao chép mã", exact: true })
    .first()
    .click();
  await page.getByText("Đã sao chép", { exact: true }).waitFor();
  check(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ) === "print('Xin chào')\nformula = r'\\[x^2\\]'\n",
    "Clipboard includes toolbar or changed code",
  );
  await page.screenshot({
    path: "output/playwright/chat-math-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile horizontal overflow",
  );
  await page.screenshot({
    path: "output/playwright/chat-math-mobile.png",
    fullPage: true,
  });
  const textbox = page.getByRole("textbox", { name: "Tin nhắn cho DeepSeek" });
  await textbox.fill("Tin nhắn vượt giới hạn input");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await page.getByText(/Input vượt giới hạn 1800 token/).waitFor();
  check(
    (await textbox.inputValue()) === "",
    "Oversized input restored to composer",
  );
  check(
    (await page
      .getByText("Tin nhắn vượt giới hạn input", { exact: true })
      .count()) === 1,
    "Oversized turn missing or duplicated",
  );
  await textbox.fill("Cannot continue");
  check(
    await page
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .isDisabled(),
    "Closed chat still allows messages",
  );
  await page.reload();
  await page.getByText(/Input vượt giới hạn 1800 token/).waitFor();
  check(
    (await page
      .getByText("Tin nhắn vượt giới hạn input", { exact: true })
      .count()) === 1,
    "Reload lost oversized message",
  );
  await page.screenshot({
    path: "output/playwright/chat-exhausted-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("/usage");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await page.getByText(/Phiên này: 2000\/2000/).waitFor();
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("/new");
  await page.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await page.getByText("Đã tạo đoạn chat mới.", { exact: true }).waitFor();
  check(
    (await page
      .getByText("Tin nhắn vượt giới hạn input", { exact: true })
      .count()) === 0,
    "New session retained closed turn",
  );
  await page
    .getByRole("textbox", { name: "Tin nhắn cho DeepSeek" })
    .fill("New prompt");
  check(
    await page
      .getByRole("button", { name: "Gửi tin nhắn", exact: true })
      .isEnabled(),
    "New session not usable",
  );
  check(posts === 1, "Local commands called model API");
  check(errors.length === 0, errors.join("\n"));
  return {
    passed: true,
    math: true,
    exactClipboard: true,
    mobile: true,
    persistedExhaustion: true,
    commandsAfterExhaustion: true,
    providerCalls: 0,
  };
};
