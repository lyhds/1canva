import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { storefrontUrl } from './product-studio/store-identity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const slots = ['master', 'detail', 'texture', 'scene-1', 'scene-2', 'scene-3', 'scene-desktop'];
const ratios = ['3:4', '2:3', '1:1', '4:3', '3:2', '2:1'];
const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function digest(task) {
  return hash(JSON.stringify({ spec: task.spec, accepted: task.accepted, documents: task.documents }));
}
export function blockers(task, dir) {
  const errors = [];
  const spec = task.spec || {};
  if (!ratios.includes(spec.ratio)) errors.push('Confirm a supported ratio');
  if (!['extract', 'create'].includes(spec.mode)) errors.push('Confirm extract/create mode');
  if (!spec.rightsConfirmed) errors.push('Confirm commercial reference rights');
  if (!['omit', 'include'].includes(spec.textureDecision)) errors.push('Resolve texture decision');
  if (!spec.textureReason) errors.push('Record visual texture reasoning');
  if (!spec.productionConfirmed) errors.push('Confirm production and delivery compatibility');
  for (const slot of slots.filter(s => (s !== 'texture' || spec.textureDecision === 'include') && (s !== 'scene-desktop' || spec.mediaProfile === 'responsive-v1'))) {
    const item = task.versions.find(v => v.id === task.accepted[slot]);
    if (!item) { errors.push(`Accept ${slot}`); continue; }
    if (!fs.existsSync(path.join(dir, item.file)) || hash(fs.readFileSync(path.join(dir, item.file))) !== item.sha256) errors.push(`Changed file: ${slot}`);
    if (slot !== 'master' && item.master !== task.accepted.master) errors.push(`Stale master: ${slot}`);
    if (slot === 'detail' && item.method !== 'crop') errors.push('Detail must be a real crop');
    if (slot.startsWith('scene-') && item.method !== 'scene-room-v1') errors.push('Scene must use scene-room-v1');
  }
  for (const name of ['copy', 'rules', 'pricing']) {
    const doc = task.documents[name];
    if (!doc) { errors.push(`Import ${name}`); continue; }
    if (!fs.existsSync(path.join(dir, doc.file)) || hash(fs.readFileSync(path.join(dir, doc.file))) !== doc.sha256) errors.push(`Changed document: ${name}`);
  }
  const pricing = task.documents.pricing;
  if (pricing && fs.existsSync(path.join(dir, pricing.file))) {
    const data = readJSON(path.join(dir, pricing.file));
    if (data.currency !== 'USD' || !Array.isArray(data.variants) || !data.variants.length) errors.push('USD variant price table required');
    const keys = new Set();
    for (const v of data.variants || []) {
      const key = JSON.stringify([v.size, v.frame]);
      if (!v.size || !v.frame || !Number.isSafeInteger(v.priceCents) || v.priceCents <= 0 || keys.has(key)) errors.push('Invalid or duplicate priced variant');
      keys.add(key);
    }
    if (!data.confirmed || !data.referenceProductIds?.length || !data.rounding) errors.push('Confirm pricing provenance and rounding');
  }
  if (Object.values(task.operations).some(op => !['complete', 'cancelled'].includes(op.status))) errors.push('Resolve pending or uncertain operations');
  return errors;
}
export function execute(base, command, id, args = []) {
  requireThat(validId(id), 'Task id must use lowercase letters, digits and hyphens');
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const lock = path.join(base, `${id}.lock`);
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch { throw new Error('Task locked; inspect running processes before manually recovering its lock'); }
  try {
    const dir = path.join(base, id), file = path.join(dir, 'task.json');
    if (command === 'init') {
      requireThat(!fs.existsSync(dir), 'Task already exists');
      fs.mkdirSync(dir, { mode: 0o700 });
      const task = { schema: 1, id, store: storefrontUrl().replace(/\/$/, ''), createdAt: new Date().toISOString(), spec: {}, versions: [], accepted: {}, documents: {}, operations: {}, history: [] };
      save(file, task); return task;
    }
    const task = readJSON(file);
    if (command === 'status') return { ...task, blockers: blockers(task, dir), digest: digest(task) };
    requireThat(!task.published, 'Published task is immutable; create a separate task for amendments');
    requireThat(command === 'finish' || !Object.values(task.operations).some(op => ['pending', 'uncertain'].includes(op.status)), 'Resolve pending operation before changing task');
    const oldDigest = digest(task);
    if (command === 'spec') {
      const previousSpec = task.spec;
      task.spec = readJSON(args[0]);
      requireThat(ratios.includes(task.spec.ratio), 'Unsupported ratio');
      requireThat(['extract', 'create'].includes(task.spec.mode), 'Unsupported mode');
      if (previousSpec.ratio !== task.spec.ratio || previousSpec.mode !== task.spec.mode) task.accepted = {};
    } else if (command === 'import') {
      const [slot, source, method] = args;
      requireThat(slots.includes(slot) || slot === 'reference', 'Unknown image slot');
      requireThat(slot === 'master' || slot === 'reference' || task.accepted.master, 'Accept master first');
      const ext = path.extname(source).toLowerCase();
      requireThat(['.png', '.jpg', '.jpeg', '.webp'].includes(ext), 'Use PNG, JPEG or WebP');
      const version = crypto.randomUUID();
      const name = `${slot}-${version}${ext}`;
      const bytes = fs.readFileSync(source);
      let crop;
      if (slot === 'detail') {
        requireThat(method === 'crop', 'Detail must be a real crop');
        crop = readJSON(`${source}.json`);
        const master = task.versions.find(v => v.id === task.accepted.master);
        requireThat(crop.method === 'crop' && crop.sourceSHA256 === master.sha256 && crop.outputSHA256 === hash(bytes), 'Crop provenance does not match accepted master and detail');
      }
      fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx', mode: 0o600 });
      task.versions.push({ id: version, slot, file: name, sha256: hash(bytes), master: slot === 'master' || slot === 'reference' ? null : task.accepted.master, method: method || 'import', crop, createdAt: new Date().toISOString() });
    } else if (command === 'accept') {
      const version = task.versions.find(v => v.id === args[0]);
      requireThat(version && version.slot !== 'reference', 'Unknown product image version');
      requireThat(version.slot === 'master' || version.master === task.accepted.master, 'Version belongs to an old master');
      requireThat(args[1]?.trim(), 'Record the user approval evidence');
      if (version.slot === 'master' && task.accepted.master !== version.id) task.accepted = {};
      task.accepted[version.slot] = version.id;
    } else if (command === 'document') {
      const [name, source] = args;
      requireThat(['copy', 'rules', 'pricing'].includes(name), 'Unknown document');
      readJSON(source);
      const bytes = fs.readFileSync(source), target = `${name}-${crypto.randomUUID()}.json`;
      fs.writeFileSync(path.join(dir, target), bytes, { flag: 'wx', mode: 0o600 });
      task.documents[name] = { file: target, sha256: hash(bytes) };
    } else if (command === 'approve') {
      requireThat(args[0] === digest(task), 'Review digest changed');
      requireThat(args[1]?.trim(), 'Record explicit final user approval');
      requireThat(blockers(task, dir).length === 0, blockers(task, dir).join('; '));
      task.approval = { digest: digest(task), evidence: args[1], at: new Date().toISOString() };
    } else if (command === 'begin') {
      const [key, kind, evidence] = args;
      requireThat(validId(key) && ['generation', 'shopify'].includes(kind), 'Invalid operation key or kind');
      requireThat(evidence?.trim(), 'Record user authorization before external writes');
      requireThat(!task.operations[key], 'Operation exists: reconcile its remote result, never blindly retry');
      requireThat(!Object.values(task.operations).some(op => ['pending', 'uncertain'].includes(op.status)), 'Resolve existing operation first');
      if (kind === 'shopify') requireThat(task.approval?.digest === digest(task) && blockers(task, dir).length === 0, 'Current task must be fully reviewed and approved');
      task.operations[key] = { kind, evidence, digest: digest(task), status: 'pending', startedAt: new Date().toISOString() };
    } else if (command === 'finish') {
      const [key, source] = args, op = task.operations[key], receipt = readJSON(source);
      requireThat(op && ['pending', 'uncertain'].includes(op.status), 'No pending operation');
      requireThat(['complete', 'uncertain', 'cancelled'].includes(receipt.status), 'Invalid receipt status');
      requireThat(receipt.evidence, 'Receipt must describe readback or reconciliation evidence');
      if (receipt.productId) {
        requireThat(/^gid:\/\/shopify\/Product\/\d+$/.test(receipt.productId), 'Invalid product ID');
        requireThat(!task.productId || task.productId === receipt.productId, 'Never replace a task product ID');
        task.productId = receipt.productId;
      }
      if (receipt.published) {
        requireThat(op.kind === 'shopify' && receipt.status === 'complete' && task.productId && receipt.readbackVerified && op.digest === digest(task), 'Verified readback of the approved product required');
        task.published = { productId: task.productId, at: new Date().toISOString() };
      }
      Object.assign(op, { status: receipt.status, receipt, updatedAt: new Date().toISOString() });
    } else throw new Error('Unknown command');
    if (digest(task) !== oldDigest) delete task.approval;
    task.history.push({ command, at: new Date().toISOString(), evidence: ['accept', 'approve'].includes(command) ? args[1] : undefined });
    save(file, task);
    return { id, digest: digest(task), latestVersion: task.versions.at(-1)?.id, productId: task.productId, published: task.published || false };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id, ...args] = process.argv.slice(2);
  if (!command || command === '--help') console.log('Local only. Commands: init ID | status ID | spec ID JSON | import ID SLOT IMAGE METHOD | accept ID VERSION EVIDENCE | document ID copy|rules|pricing JSON | approve ID DIGEST EVIDENCE | begin ID KEY generation|shopify EVIDENCE | finish ID KEY RECEIPT_JSON\nState: .shopify/canvasra-workflow/. Never executes API calls. External operations are performed by Codex under SKILL.md.');
  else {
    try { console.log(JSON.stringify(execute(path.join(ROOT, '.shopify/canvasra-workflow'), command, id, args), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
