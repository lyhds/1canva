import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {connectionConfig, testConnection} from './product-studio/connection.js';
import {Store, atomic} from './product-studio/store.js';
import {createApp} from './product-studio/server.js';

const config = {endpoint: 'https://provider.example/v1/chat/completions', model: 'demo', apiKey: 'SECRET'};

test('connection probe is GET-only and preserves provider API prefixes for both model types', async () => {
  for (const suffix of ['chat/completions', 'images/edits', 'images/generations/']) {
    const result = await testConnection({...config, endpoint: 'https://provider.example/custom/v1/'+suffix}, async (url, options) => {
      assert.equal(url, 'https://provider.example/custom/v1/models');
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer SECRET');
      return Response.json({data: [{id: 'demo'}]});
    });
    assert.equal(result.status, 'success');
    assert.match(result.message, /尚未验证/);
    assert.ok(Number.isFinite(result.elapsedMs));
  }
});

test('probe distinguishes authentication, rate limit, unsupported endpoint and missing model without echoing secrets', async () => {
  for (const [http, expected] of [[401,'error'],[403,'error'],[429,'error'],[500,'error'],[404,'unsupported'],[405,'unsupported']]) {
    const result = await testConnection(config, async () => new Response('provider echoed SECRET', {status: http}));
    assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  assert.equal((await testConnection(config, async () => Response.json({data: [{id:'other'}]}))).status, 'warning');
  assert.equal((await testConnection(config, async () => new Response('<html>proxy</html>'))).status, 'unsupported');
  assert.equal((await testConnection(config, async () => Response.json({data:[null]}))).status, 'unsupported');
  const failure = await testConnection(config, async () => {throw Error('network SECRET');});
  assert.equal(failure.status, 'error');
  assert.ok(!JSON.stringify(failure).includes('SECRET'));
  assert.equal((await testConnection({...config, endpoint:'https://provider.example/custom'}, () => assert.fail('must not guess a custom route'))).status, 'unsupported');
});

test('unsaved configuration can use saved keys only on the same origin and rejects unsafe addresses', () => {
  assert.equal(connectionConfig({...config, apiKey:''}, config).apiKey, 'SECRET');
  assert.equal(connectionConfig({...config, apiKey:'NEW'}, config).apiKey, 'NEW');
  assert.throws(() => connectionConfig({...config, endpoint:'https://other.example/v1/images/edits', apiKey:''}, config), /重新填写/);
  for (const endpoint of ['http://provider.example/v1', 'https://user:password@provider.example/v1', 'https://provider.example/v1?key=SECRET', 'bad-url']) {
    assert.throws(() => connectionConfig({...config, endpoint}), /HTTPS/);
  }
  assert.throws(() => connectionConfig({...config, apiKey:''}), /API Key/);
  assert.throws(() => connectionConfig({...config, model:' '}), /模型名称/);
});

test('connection API accepts unsaved fields, keeps settings unchanged, enforces CSRF and prevents duplicate requests', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvasra-connection-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(resolved, {recursive:true, force:true});
  });
  const store = new Store(directory);
  atomic(path.join(directory,'settings.json'), {...store.settings(), vision:config});
  const before = fs.readFileSync(path.join(directory,'settings.json'),'utf8');
  let release, calls=0;
  const app = createApp({store, shopify:{configured:()=>false}, pipeline:{recover(){},tick(){}}, connectionTest:async c => {
    calls++;
    assert.equal(c.model, 'unsaved');
    assert.equal(c.apiKey, 'SECRET');
    await new Promise(resolve => {release=resolve;});
    return {status:'success', message:'连接成功'};
  }});
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = 'http://127.0.0.1:'+app.server.address().port;
  const {token} = await (await fetch(base+'/api/bootstrap')).json();
  const request = (headers={}) => fetch(base+'/api/connections/test', {method:'POST', headers:{'Content-Type':'application/json',...headers}, body:JSON.stringify({kind:'vision', endpoint:config.endpoint, model:'unsaved', apiKey:''})});
  assert.equal((await request()).status,403);
  const headers = {'X-Studio-Token':token};
  assert.equal((await request({...headers,Origin:'https://other.example'})).status,403);
  assert.equal((await fetch(base+'/api/connections/test')).status,405);
  const pending = request(headers);
  for(let n=0;!release&&n<100;n++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(release, 'probe started');
  assert.equal((await request(headers)).status,409);
  release();
  const response = await pending;
  assert.equal(response.status,200);
  const text = await response.text();
  assert.ok(!text.includes('SECRET'));
  assert.equal(calls,1);
  assert.equal(fs.readFileSync(path.join(directory,'settings.json'),'utf8'),before);
  assert.equal(store.list().length,0);
});
