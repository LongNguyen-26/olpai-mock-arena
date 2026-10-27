import { test } from "node:test";
import assert from "node:assert/strict";
import { taskStatements } from "../src/lib/statements";
import type { ContestPackage } from "../src/lib/types";
test("task pages omit editorial preamble and references while preserving task text", () => {
  const pkg = {
    statement:
      "# Đề tổng\nĐây không phải đề hoặc quy chế\n## Mô hình và dữ liệu được phép\nGiữ luật model.\n## Xếp hạng\nOld scoring\n# Tác vụ 1 Tách nhân\nSchema CV.\n# Tác vụ 2 Đọc hiểu\nSchema QA.\n# Nộp bài và tái tạo kết quả\nFinal\n# Nguồn tham khảo và phạm vi suy luận\nEditorial",
  } as ContestPackage;
  const pages = taskStatements(pkg);
  assert.equal(pages.length, 2);
  assert.ok(pages[0].content.includes("Schema CV."));
  assert.ok(!pages[0].content.includes("Schema QA."));
  assert.ok(pages[1].content.includes("Schema QA."));
  assert.ok(
    pages.every(
      (p) =>
        p.content.includes("Giữ luật model.") &&
        p.content.includes("tối đa 200 điểm"),
    ),
  );
  assert.ok(!JSON.stringify(pages).includes("Editorial"));
  assert.ok(!JSON.stringify(pages).includes("không phải đề hoặc quy chế"));
});
test("new packages can provide task-specific pages without parsing the legacy statement", () => {
  const tasks = [
    { id: "1" as const, title: "Bài A", content: "A" },
    { id: "2" as const, title: "Bài B", content: "B" },
  ];
  assert.deepEqual(taskStatements({ tasks } as ContestPackage), tasks);
});
