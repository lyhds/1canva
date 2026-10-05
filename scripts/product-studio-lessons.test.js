import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sceneLessons } from "./product-studio/pipeline.js";

/**
 * The scene lessons are shared with the Codex product skill. Studio must keep
 * working from the repository default, but the location is configurable and a
 * missing file has to fail with a message a person can act on.
 */
test("the shipped scene lessons load from the repository default", () => {
  delete process.env.CANVASRA_SCENE_LESSONS;
  const text = sceneLessons();
  assert.ok(text.length > 100, "scene lessons should not be empty");
});

test("CANVASRA_SCENE_LESSONS points Studio at an installation-specific copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canvasra-lessons-"));
  const file = path.join(root, "lessons.md");
  fs.writeFileSync(file, "custom scene lessons\n");
  process.env.CANVASRA_SCENE_LESSONS = file;
  try {
    assert.equal(sceneLessons(), "custom scene lessons\n");
  } finally {
    delete process.env.CANVASRA_SCENE_LESSONS;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a missing lessons file fails with an actionable message instead of ENOENT", () => {
  process.env.CANVASRA_SCENE_LESSONS = path.join(os.tmpdir(), "canvasra-definitely-missing-lessons.md");
  try {
    assert.throws(() => sceneLessons(), (error) => {
      assert.match(error.message, /缺少场景经验文件/);
      assert.match(error.message, /CANVASRA_SCENE_LESSONS/);
      assert.doesNotMatch(error.message, /ENOENT/);
      return true;
    });
  } finally {
    delete process.env.CANVASRA_SCENE_LESSONS;
  }
});
