import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "./product-studio/server.js";
import {Store} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import sharp from 'sharp';

/**
 * Route-level contract tests for the local Product Studio server. Everything
 * runs against stubbed store/shopify/pipeline objects on an ephemeral port:
 * no credential is read, no model is called and no Shopify record is touched.
 */
function fixtures(root) {
  const job = { id: "job-1", title: "Test painting", status: "paused", stage: "等待", operations: [], assets: {}, delivery: "all" };
  const store = {
    dir: root,
    job,
    saved: null,
    list: () => [job],
    get: (id) => { if (id !== job.id) throw Error("任务不存在"); return job; },
    publicJob: (value) => ({ id: value.id, title: value.title, status: value.status }),
    jobDir: () => root,
    file: (id, name) => path.join(root, name),
    settings: () => ({ libraryRoot: path.join(root, "library"), profiles: {} }),
    publicSettings: () => ({ vision: { hasKey: false, endpoint: "", model: "" }, image: { hasKey: false, endpoint: "", model: "" } }),
    saveSettings: (input) => { store.saved = input; return input; },
    save: () => {},
    event: () => {},
    create: () => job,
    addAsset: () => {},
  };
  const shopify = { configured: () => true, find: async () => [], product: async () => null };
  const pipeline = { busy: false, stopped: false, recover() {}, tick() {} };
  return { store, shopify, pipeline };
}

async function withApp(run, { create = createApp } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canvasra-studio-"));
  const parts = fixtures(root);
  const app = create({ store: parts.store, shopify: parts.shopify, pipeline: parts.pipeline, connectionTest: async () => ({ ok: true }) });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  try {
    await run({ base: `http://127.0.0.1:${port}`, port, ...parts });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const json = async (response) => ({ status: response.status, body: await response.json() });

test('creating tasks saves the reference then queues them without a separate run request',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-create-queued-')),store=new Store(root);
 const worker=new Pipeline(store,{}),started=[];worker.busy=true;
 worker.run=async j=>{assert.ok(store.active(j,'reference')?.accepted);started.push(j.id);j.status='draft';store.save(j);};
 const app=createApp({store,shopify:{configured:()=>false},pipeline:worker});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/bootstrap')).json();
 const data=(await sharp({create:{width:30,height:40,channels:3,background:'white'}}).png().toBuffer()).toString('base64');
 const post=input=>fetch(base+'/api/jobs',{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await post({data:'invalid image'})).status,400);assert.equal(store.list().length,0);
 const ids=[];
 for(const target of ['draft','publish']){
  const response=await post({data,mode:'extract',delivery:'framed-only',target});assert.equal(response.status,201);
  const job=await response.json();ids.push(job.id);assert.equal(job.status,'queued');assert.equal(job.target,target);
  assert.equal(job.mode,'extract');assert.equal(job.delivery,'framed-only');
  const saved=store.get(job.id),reference=store.active(saved,'reference');
  assert.deepEqual(fs.readFileSync(store.file(job.id,reference.file)),Buffer.from(data,'base64'));
 }
 await worker.tick();assert.equal(started.length,0,'new tasks wait while the worker is busy');
 worker.busy=false;await worker.tick();await worker.tick();await worker.tick();
 assert.deepEqual(started,ids,'each newly created task executes exactly once in queue order');
});

test("bootstrap hands out the request token and the first job list", async () => {
  await withApp(async ({ base }) => {
    const { status, body } = await json(await fetch(`${base}/api/bootstrap`));
    assert.equal(status, 200);
    assert.match(body.token, /^[0-9a-f]{64}$/);
    assert.equal(body.shopifyConfigured, true);
    assert.deepEqual(body.jobs, [{ id: "job-1", title: "Test painting", status: "paused" }]);
    // the handed-out token is the one write requests must present
    const accepted = await fetch(`${base}/api/jobs/job-1/pause`, { method: "POST", headers: { "X-Studio-Token": body.token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(accepted.status, 200);
  });
});

test("only loopback hosts and token-carrying writes are accepted", async () => {
  await withApp(async ({ base, port }) => {
    // a non-loopback Host header is rejected before any routing happens
    const foreign = await new Promise((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, path: "/api/bootstrap", headers: { Host: "evil.example:80" } }, (response) => {
        let text = "";
        response.on("data", (chunk) => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(foreign.status, 403);
    assert.match(foreign.body.error, /只允许本机访问/);

    // writes without the token, or with the wrong one, are rejected
    for (const headers of [{}, { "X-Studio-Token": "0".repeat(64) }]) {
      const response = await fetch(`${base}/api/jobs/job-1/pause`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /来源验证失败/);
    }
    // reads stay available without a token
    assert.equal((await fetch(`${base}/api/jobs`)).status, 200);
  });
});

test("job actions fail closed on unknown actions and unverified external results", async () => {
  await withApp(async ({ base, store }) => {
    const token = (await (await fetch(`${base}/api/bootstrap`)).json()).token;
    const post = (action, body = "{}") => fetch(`${base}/api/jobs/job-1/${action}`, { method: "POST", headers: { "X-Studio-Token": token, "Content-Type": "application/json" }, body });

    const unknown = await json(await post("explode"));
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /未知操作/);

    // a job with an unconfirmed external request must be reconciled first
    store.job.status = "uncertain";
    const run = await json(await post("run"));
    assert.equal(run.status, 400);
    assert.match(run.body.error, /先核对未确认请求/);

    // published jobs are read-only
    store.job.status = "published";
    const replace = await json(await post("retry", JSON.stringify({ slot: "master" })));
    assert.equal(replace.status, 400);
    assert.match(replace.body.error, /只读/);

    // pause keeps working outside those guards and writes its checkpoint file
    store.job.status = "running";
    const paused = await json(await post("pause"));
    assert.equal(paused.status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store.dir, "pause.json"), "utf8")), { requested: true });
  });
});

test("new-task requests validate delivery and the reference image before writing", async () => {
  await withApp(async ({ base }) => {
    const token = (await (await fetch(`${base}/api/bootstrap`)).json()).token;
    const create = (payload) => fetch(`${base}/api/jobs`, { method: "POST", headers: { "X-Studio-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const delivery = await json(await create({ delivery: "rolled-only", data: "xx" }));
    assert.equal(delivery.status, 400);
    assert.match(delivery.body.error, /无效交付方式/);
    const reference = await json(await create({ delivery: "all" }));
    assert.equal(reference.status, 400);
    assert.match(reference.body.error, /请上传参考图/);
  });
});

test("settings reads are open, writes are blocked while a job is running", async () => {
  await withApp(async ({ base, store, pipeline }) => {
    const token = (await (await fetch(`${base}/api/bootstrap`)).json()).token;
    const read = await json(await fetch(`${base}/api/settings`));
    assert.equal(read.status, 200);
    assert.equal(read.body.vision.hasKey, false);

    pipeline.busy = true;
    const blocked = await json(await fetch(`${base}/api/settings`, { method: "POST", headers: { "X-Studio-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ vision: {} }) }));
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /任务运行中/);
    assert.equal(store.saved, null);

    pipeline.busy = false;
    const saved = await json(await fetch(`${base}/api/settings`, { method: "POST", headers: { "X-Studio-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ vision: { model: "x" } }) }));
    assert.equal(saved.status, 200);
    assert.deepEqual(store.saved, { vision: { model: "x" } });
  });
});

test("connection tests require POST and a known model kind", async () => {
  await withApp(async ({ base }) => {
    const token = (await (await fetch(`${base}/api/bootstrap`)).json()).token;
    const read = await json(await fetch(`${base}/api/connections/test`));
    assert.equal(read.status, 405);
    const wrongKind = await json(await fetch(`${base}/api/connections/test`, { method: "POST", headers: { "X-Studio-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "video" }) }));
    assert.equal(wrongKind.status, 400);
    assert.match(wrongKind.body.error, /有效的模型配置/);
  });
});

test("media and shell routes only serve whitelisted files", async () => {
  await withApp(async ({ base, store }) => {
    // the shell is served, anything else in the web folder or the repo is not
    const shell = await fetch(`${base}/`);
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /CANVASRA · Product Studio/);
    for (const notServed of ["/server.js", "/store.js", "/package.json"]) {
      assert.equal((await fetch(`${base}${notServed}`)).status, 404, notServed);
    }
    // media is limited to stored png assets
    assert.equal((await fetch(`${base}/media/job-1/notes.txt`)).status, 404);
    assert.equal((await fetch(`${base}/media/job-1/missing.png`)).status, 404);
    // the library route reports an empty reference library instead of failing
    const library = await json(await fetch(`${base}/api/library`));
    assert.equal(library.status, 200);
    assert.deepEqual(library.body, []);
  });
});

test("the Studio shell, its scripts and the server whitelist agree", () => {
  const html = fs.readFileSync("scripts/product-studio/web/index.html", "utf8");
  const app = fs.readFileSync("scripts/product-studio/web/app.js", "utf8");
  const server = fs.readFileSync("scripts/product-studio/server.js", "utf8");
  for (const asset of ["app.js", "style.css"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(server.includes(`'${asset}'`), `server whitelist must include ${asset}`);
  }
  for (const endpoint of ["/api/bootstrap", "/api/settings", "/api/library", "/api/jobs", "/api/catalog"]) {
    assert.ok(app.includes(endpoint), `app.js must call ${endpoint}`);
    assert.ok(server.includes(`'${endpoint}'`), `server must route ${endpoint}`);
  }
  // every button action the UI can post must exist in the route table
  const actions = [...app.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(actions.length >= 5, `expected UI actions, found ${actions.length}`);
  for (const action of new Set(actions)) assert.ok(server.includes(`action==='${action}'`), `server missing action ${action}`);
  for (const action of ["retry", "resolve"]) assert.ok(server.includes(`action==='${action}'`), `server missing action ${action}`);
});

test('typed recovery routes isolate analysis, image receipts and Shopify reconciliation',async()=>withApp(async({base,store,shopify})=>{
 const {token}=await(await fetch(base+'/api/bootstrap')).json();const j=store.get('job-1');
 const post=async(action,input={})=>{const r=await fetch(base+'/api/jobs/job-1/'+action,{method:'POST',headers:{'content-type':'application/json','x-studio-token':token},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
 j.status='uncertain';j.operations=[{label:'分析作品',status:'pending'}];
 shopify.find=async()=>assert.fail('analysis must not query Shopify');
 assert.equal((await post('reconcile')).status,400);
 assert.equal((await post('retry-analysis')).status,200);assert.equal(j.status,'queued');
 j.status='uncertain';j.operations=[{id:'image-op',label:'生成 scene-3 #1',status:'uncertain'}];store.active=()=>null;
 const result=await post('query-result');assert.equal(result.status,200);assert.match(result.body.message,/未收到不代表未生成/);assert.equal(j.status,'uncertain');
 assert.equal((await post('retry-image')).status,200);assert.equal(j.status,'queued');
}));
