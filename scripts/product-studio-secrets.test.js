import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, atomic, withoutSecrets } from "./product-studio/store.js";

const SECRET = "SECRET-VISION-KEY";
const IMAGE_SECRET = "SECRET-IMAGE-KEY";

function fixture(t) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "studio-secrets-")));
  t.after(() => fs.rmSync(store.dir, { recursive: true, force: true }));
  atomic(path.join(store.dir, "settings.json"), {
    ...store.settings(),
    vision: { endpoint: "https://vision.example/v1/chat/completions", model: "glm-5.3-flash", apiKey: SECRET },
    image: { endpoint: "https://image.example/v1/images/edits", model: "gpt-image-2-vip", apiKey: IMAGE_SECRET, protocol: "openai-edit" },
  });
  return store;
}

const rawJob = (store, id) => fs.readFileSync(path.join(store.dir, "jobs", id, "job.json"), "utf8");

test("a saved job keeps its model snapshot but never the credential", (t) => {
  const store = fixture(t);
  const job = store.create({ title: "Secret handling" });
  job.config = store.settings();
  job.assets.master = [{ file: "master-1.png", accepted: true }];
  store.save(job);

  const raw = rawJob(store, job.id);
  assert.doesNotMatch(raw, new RegExp(SECRET), "vision key must not reach the job file");
  assert.doesNotMatch(raw, new RegExp(IMAGE_SECRET), "image key must not reach the job file");
  const saved = JSON.parse(raw);
  assert.equal(saved.config.vision.apiKey, undefined);
  assert.equal(saved.config.image.apiKey, undefined);
  // the snapshot still records which endpoints and models produced the assets
  assert.equal(saved.config.vision.model, "glm-5.3-flash");
  assert.equal(saved.config.image.model, "gpt-image-2-vip");
  assert.equal(saved.config.image.protocol, "openai-edit");

  // the running process can still call the models, because config() merges the key in
  assert.equal(store.config(job).vision.apiKey, SECRET);
  assert.equal(store.config(job).image.apiKey, IMAGE_SECRET);
  assert.equal(store.config(job).vision.endpoint, "https://vision.example/v1/chat/completions");
});

test("a job reloaded from disk resumes with the current credential", (t) => {
  const store = fixture(t);
  const job = store.create({ title: "Resume" });
  job.config = store.settings();
  job.status = "paused";
  store.save(job);

  const reloaded = store.get(job.id); // exactly what the worker does after a restart
  assert.equal(reloaded.config.vision.apiKey, undefined, "the file has no key");
  assert.equal(store.config(reloaded).vision.apiKey, SECRET, "the key comes from settings at run time");

  // rotating the key in settings applies to the already-saved job
  atomic(path.join(store.dir, "settings.json"), {
    ...store.settings(),
    vision: { endpoint: "https://vision.example/v1/chat/completions", model: "glm-5.3-flash", apiKey: "ROTATED-KEY" },
  });
  assert.equal(store.config(reloaded).vision.apiKey, "ROTATED-KEY");
  assert.doesNotMatch(rawJob(store, job.id), /ROTATED-KEY/);
});

test("the browser payload never exposes the config or the key", (t) => {
  const store = fixture(t);
  const job = store.create({ title: "Public job" });
  job.config = store.settings();
  store.save(job);
  const publicJob = store.publicJob(store.get(job.id));
  assert.equal("config" in publicJob, false);
  assert.doesNotMatch(JSON.stringify(publicJob), new RegExp(SECRET));
  assert.deepEqual(publicJob.modelSnapshot, { vision: "glm-5.3-flash", image: "gpt-image-2-vip" });
});

test("redaction tolerates jobs without a config and exports a reusable helper", () => {
  assert.deepEqual(withoutSecrets({ id: "x" }), { id: "x" });
  const redacted = withoutSecrets({ id: "x", config: { vision: { apiKey: "k", model: "m" }, libraryRoot: "/lib" } });
  assert.equal(redacted.config.vision.apiKey, undefined);
  assert.equal(redacted.config.vision.model, "m");
  assert.equal(redacted.config.libraryRoot, "/lib");
  assert.equal(JSON.stringify(redacted).includes('"apiKey"'), false, "undefined keys are dropped by JSON");
});
