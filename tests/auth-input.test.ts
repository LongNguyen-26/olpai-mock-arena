import test from "node:test";
import assert from "node:assert/strict";
import { registrationName, loginName } from "../src/lib/auth-input";
import { templateSchema, defaultTemplate } from "../src/lib/workspace-domain";

test("new accounts use canonical email addresses including addresses longer than legacy usernames", () => {
  assert.equal(
    registrationName.parse("  Nguyen.Student2026@Example.edu.vn  "),
    "nguyen.student2026@example.edu.vn",
  );
  for (const s of [
    "arena_admin",
    "student@",
    "student@example",
    "student @example.com",
    "",
    "a".repeat(250) + "@example.com",
  ])
    assert.equal(registrationName.safeParse(s).success, false);
});
test("existing usernames and new email accounts can both log in", () => {
  assert.equal(loginName.parse(" Arena_Admin "), "arena_admin");
  assert.equal(
    loginName.parse("Student.Long.Email@example.edu.vn"),
    "student.long.email@example.edu.vn",
  );
  assert.equal(loginName.safeParse(" ").success, false);
});
test("service-specific templates retain legacy compatibility and reject unknown services", () => {
  const template = {
    ...defaultTemplate,
    imageName: "example/image@sha256:abc",
  };
  assert.equal(templateSchema.safeParse(template).success, true);
  for (const services of ["both", "llm", "jupyter"])
    assert.equal(
      templateSchema.parse({ ...template, services }).services,
      services,
    );
  assert.equal(
    templateSchema.safeParse({ ...template, services: "other" }).success,
    false,
  );
});
