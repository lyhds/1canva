import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";

/**
 * Minimal DOM coverage for the Studio web app. The shell and the real app.js run
 * in a linkedom document against a stubbed fetch: no server, no model call and no
 * Shopify write happens here. Covers boot rendering, output escaping, the detail
 * view, the write token and error surfacing.
 */
const TOKEN = "a".repeat(64);
const SHELL = fs.readFileSync("scripts/product-studio/web/index.html", "utf8");
const APP = fs.readFileSync("scripts/product-studio/web/app.js", "utf8");

const job = (overrides = {}) => ({
  id: "job-1",
  title: "Sunlit Stairwell",
  status: "draft",
  stage: "等待上架",
  mode: "create",
  delivery: "all",
  target: "draft",
  mediaProfile: "responsive-v1",
  sceneWorkflow: "composed-unframed-v1",
  bannerProfile: "clearance-v3",
  desktopAspectRatio: "21:9",
  publicationRequested: true,
  canSkipReviews: false,
  recoveryPolicy: { enabled: true, maxGenerations: 3 },
  modelSnapshot: { vision: "glm-5.3-flash", image: "gpt-image-2-vip" },
  events: [{ at: new Date().toISOString(), text: "商品已发布，回读验证通过" }],
  updatedAt: new Date().toISOString(),
  analysis: { ratio: "3:4" },
  // shape returned by the server: the draft template it priced from, the table version
  // and the size/frame combinations it will create
  pricing: {
    reference: { id: "gid://shopify/Product/1000000000001", title: "[RATIO DRAFT] Example Study — 3:4 Portrait", status: "DRAFT" },
    priceTableVersion: "2026-09-09-mesonart-modal-v3",
    variants: [
      { size: "61 x 81 cm / 24 x 32 in", frame: "Stretched Canvas", price: "526.00" },
      { size: "61 x 81 cm / 24 x 32 in", frame: "Oak Float Frame", price: "600.00" },
      { size: "76 x 102 cm / 30 x 40 in", frame: "Oak Float Frame", price: "880.00" },
    ],
  },
  operations: [],
  assets: {
    master: [{ file: "master-1.png", url: "/media/job-1/master-1.png", width: 1536, height: 2048, accepted: true, cost: { amount: 0.4, currency: "CNY", source: "owner-estimate" } }],
    "scene-1": [{ file: "scene-1-1.png", url: "/media/job-1/scene-1-1.png", width: 1600, height: 2000, accepted: true, cost: { amount: 0.4, currency: "CNY", source: "owner-estimate" } }],
  },
  costSummary: { byCurrency: { CNY: 0.8 }, images: 2, estimatedImages: 2 },
  ...overrides,
});

async function boot({ jobs = [job()], token = TOKEN, failJobsAfterWrite = false, failDelete = false, createdStatus = 'queued', styles = [] } = {}) {
  const { window, document } = parseHTML(SHELL);
  Object.defineProperty(document, "activeElement", { value: document.body, writable: true, configurable: true });
  const calls = [];
  let written = false;
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchStub = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body });
    if (url === "/api/bootstrap") return json({ token, settings: { vision: { hasKey: true }, image: { hasKey: true } }, shopifyConfigured: true, styles, jobs });
    if (url === "/api/jobs") {
      if(options.method==='POST')return json(job({id:'created-job',status:createdStatus}),201);
      if (failJobsAfterWrite && written) return json({ error: "任务正在执行，请等待或暂停" }, 400);
      return json(jobs);
    }
    if (url.endsWith('/delete') && failDelete) return json({error:'任务正在执行，请先暂停'},400);
    if (url==='/api/jobs/created-job/run')return json(job({id:'created-job',status:'queued'}));
    if (url.startsWith("/api/jobs/")) { written = true; return json({ ok: true }); }
    return json({ error: `unexpected ${url}` }, 404);
  };
  const context = vm.createContext({
    window, document, fetch: fetchStub, URL, FormData,
    FileReader: class { readAsDataURL() {} },
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    prompt: () => null, HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, AbortController,
  });
  // app.js is an ES module with top-level await; wrap it so a plain vm can run it
  await vm.runInContext(`(async () => {\n${APP}\nwindow.testCreateQueuedTask=createQueuedTask;})()`, context, { filename: "app.js" });
  const click = (selector) => {
    const target = document.querySelector(selector);
    assert.ok(target !== null && target !== undefined, `missing click target ${selector}`);
    target.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
  return { window, document, calls, click, settle };
}

test("boot renders the task list with status labels and counts", async () => {
  const { document } = await boot({ jobs: [job(), job({ id: "job-2", title: "Amber Fields", status: "published" })] });
  const content = document.querySelector("#content");
  assert.match(content.textContent, /Sunlit Stairwell/);
  assert.match(content.textContent, /Amber Fields/);
  assert.match(content.textContent, /草稿完成|已发布/);
  assert.equal(document.querySelectorAll("[data-job]").length, 2);
  assert.match(document.querySelector("#breadcrumb").textContent, /产品工作台/);
});

test("a hostile job title is escaped instead of injected", async () => {
  const payload = `<img src=x onerror="window.__pwned=1">`;
  const { window, document } = await boot({ jobs: [job({ title: payload })] });
  // Never hand a live DOM node to assert: on failure node:test tries to diff the whole
  // linkedom graph (circular, includes the document) and the runner never finishes.
  assert.equal(document.querySelectorAll("#content img[src='x']").length, 0, "no element may be created from a title");
  assert.equal(window.__pwned, undefined);
  assert.match(document.querySelector("#content").innerHTML, /&lt;img/);
  assert.equal(document.querySelectorAll("#content img").length, 1, "only the card thumbnail remains");
});

test("opening a task shows its assets and the estimated generation cost", async () => {
  const { document, click, settle } = await boot();
  click("[data-job]");
  await settle();
  const content = document.querySelector("#content");
  assert.match(content.textContent, /Sunlit Stairwell/);
  assert.match(content.textContent, /正面主图|场景一/, "asset slots are labelled");
  assert.match(content.textContent, /2 张生成/, "cost summary counts generated images");
  assert.match(content.textContent, /¥0.80/);
  assert.match(content.textContent, /按店主单价估算/, "the estimate is labelled, not presented as a real charge");
  assert.equal(document.querySelectorAll(".asset").length >= 2, true);
  assert.match(content.textContent, /24 x 32 in \/ 61 x 81 cm/, "pricing sizes show inches before centimetres");
  assert.doesNotMatch(content.textContent, /61 x 81 cm \/ 24 x 32 in/, "the raw cm-first label is never shown");
});

test("write actions carry the studio token and refresh the list", async () => {
  const { document, calls, click, settle } = await boot();
  click("[data-job]");
  await settle();
  const action = document.querySelector("[data-action]");
  assert.ok(action, "the detail view exposes an action button");
  click("[data-action]");
  await settle();
  const post = calls.find((call) => call.method === "POST");
  assert.ok(post, "the click performs a write request");
  assert.match(post.url, /^\/api\/jobs\/job-1\//);
  assert.equal(post.headers["X-Studio-Token"], TOKEN);
  // boot loads /api/bootstrap, so the only list read here is the refresh after the write
  const refreshes = calls.filter((call) => call.url === "/api/jobs" && call.method === "GET");
  assert.equal(refreshes.length, 1, "the list is refreshed exactly once after a write");
  assert.ok(calls.indexOf(refreshes[0]) > calls.indexOf(post), "the refresh happens after the write");
});

test("scene redo picks batch into one manual start", async () => {
  const { document, calls, click, settle } = await boot();
  click("[data-job]");
  await settle();
  click('[data-select-redo="scene-1"]');
  const start = document.querySelector("[data-redo-start]");
  assert.ok(start, "the batch start button appears after picking a scene");
  assert.match(start.textContent, /1 张/);
  click('[data-select-redo="scene-1"]');
  assert.equal(document.querySelector("[data-redo-start]"), null, "toggling off removes the batch button");
  click('[data-select-redo="scene-1"]');
  click("[data-redo-start]");
  await settle();
  const posts = calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    posts.map((post) => post.url.replace(/^\/api\/jobs\/job-1\//, "")),
    ["retry", "run"],
    "one retry per picked slot, then a single run",
  );
  assert.equal(posts[0].body, JSON.stringify({ slot: "scene-1" }));
  assert.equal(posts[0].headers["X-Studio-Token"], TOKEN);
});

test("a rejected refresh surfaces the server message instead of failing silently", async () => {
  const { document, click, settle } = await boot({ failJobsAfterWrite: true });
  click("[data-job]");
  await settle();
  click("[data-action]");
  await settle();
  const notice = document.querySelector("#notice");
  assert.equal(notice.hidden, false, "the notice is shown");
  assert.match(notice.textContent, /任务正在执行/);
});

test('creation starts old-server tasks automatically and never requeues already started tasks',async()=>{
 for(const createdStatus of ['new','queued','running']){
  const {window,calls}=await boot({createdStatus});
  const created=await window.testCreateQueuedTask({data:'reference',target:'draft'});
  assert.equal(created.id,'created-job');assert.equal(created.status,createdStatus==='running'?'running':'queued');
  const posts=calls.filter(c=>c.method==='POST');
  assert.deepEqual(posts.map(p=>p.url),createdStatus==='new'?['/api/jobs','/api/jobs/created-job/run']:['/api/jobs']);
  assert.equal(JSON.parse(posts[0].body).target,'draft');assert.equal(posts[0].headers['X-Studio-Token'],TOKEN);
 }
});

test('card deletion takes one click, updates attention counts and survives a stale list refresh',async()=>{
 const {document,calls,click,settle}=await boot({jobs:[job({status:'failed'}),job({id:'job-2',title:'Keep this task'})]});
 click('[data-filter="attention"]');
 assert.equal(document.querySelectorAll('[data-job]').length,1);
 assert.equal(document.querySelector('[data-delete-job]').closest('[data-job]'),null,'delete is a separate button, not nested in the card opener');
 click('[data-delete-job="job-1"]');await settle();
 assert.equal(document.querySelectorAll('[data-job]').length,0);
 assert.equal(document.querySelector('.stat:last-child strong').textContent,'00');
 assert.match(document.querySelector('#notice').textContent,/任务已删除/);
 const writes=calls.filter(c=>c.method==='POST');
 assert.deepEqual(writes.map(c=>c.url),['/api/jobs/job-1/delete']);
 assert.equal(writes[0].headers['X-Studio-Token'],TOKEN);
 click('[data-filter="all"]');assert.equal(document.querySelectorAll('[data-job]').length,1);
 click('[data-job="job-2"]');click('[data-action]');await settle(); // Stub returns the old list, including the deleted job.
 click('[data-back]');assert.equal(document.querySelectorAll('[data-job]').length,1);
 assert.equal(document.querySelector('[data-job="job-1"]'),null);
});

test('deleting from task detail returns to the list and failed deletion keeps the task visible',async()=>{
 const success=await boot();success.click('[data-job]');
 success.click('[data-delete-job]');await success.settle();
 assert.equal(success.document.querySelector('.detail-layout'),null);
 assert.equal(success.document.querySelectorAll('[data-job]').length,0);
 const failure=await boot({failDelete:true});failure.click('[data-delete-job]');await failure.settle();
 assert.equal(failure.document.querySelectorAll('[data-job]').length,1);
 assert.equal(failure.document.querySelector('[data-delete-job]').disabled,false);
 assert.match(failure.document.querySelector('#notice').textContent,/先暂停/);
});

test('style select fills from bootstrap presets with automatic as the default', async () => {
  const styles = [
    { id: 'bright-minimal', label: '明亮极简白', summary: '白墙浅木' },
    { id: 'dark-gallery', label: '深色画廊', summary: '深墙聚光' },
  ];
  const { document } = await boot({ styles });
  const sel = document.querySelector('#scene-style-select');
  assert.ok(sel, 'the create dialog exposes a style select');
  const options = [...sel.querySelectorAll('option')];
  assert.equal(options.length, 3, 'automatic plus the two presets');
  assert.equal(options[0].value, '', 'automatic stays the default');
  assert.deepEqual(options.map(o => o.value), ['', 'bright-minimal', 'dark-gallery']);
  assert.match(sel.textContent, /明亮极简白 · 白墙浅木/);
});

test('a job card shows the chosen room style', async () => {
  const { document } = await boot({ jobs: [job({ sceneStyle: 'warm-wood' })], styles: [{ id: 'warm-wood', label: '暖调木色', summary: '胡桃木' }] });
  assert.match(document.querySelector('#content').textContent, /暖调木色/);
});

test('running task delete buttons stay disabled on both list and detail',async()=>{
 const {document,calls,click,settle}=await boot({jobs:[job({status:'running'})]});
 assert.equal(document.querySelector('[data-delete-job]').disabled,true);
 click('[data-delete-job]');await settle();
 click('[data-job]');assert.equal(document.querySelector('[data-delete-job]').disabled,true);
 click('[data-delete-job]');await settle();
 assert.equal(calls.some(c=>c.url.endsWith('/delete')),false);
});
