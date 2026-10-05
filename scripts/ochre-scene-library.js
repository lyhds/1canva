import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Inventory only. Visual selection belongs to the canvasra-product skill.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repo, ".agents/skills/canvasra-product/scene-library.json");
try {
  const config = JSON.parse((await fs.readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  if (typeof config.root !== "string" || !config.root.trim()) throw new Error("Invalid library root");
  if (!Array.isArray(config.extensions) || !config.extensions.every(x => typeof x === "string" && /^\.[a-z0-9]+$/i.test(x))) throw new Error("Invalid image extensions");
  const root = path.resolve(repo, config.root);
  const extensions = new Set(config.extensions.map(x => x.toLowerCase()));
  const files = [], skipped = [];
  async function scan(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relativePath = path.relative(root, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) { skipped.push({ relativePath, reason: "symlink" }); continue; }
      if (entry.isDirectory()) { if (config.recursive !== false) await scan(full); continue; }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(full);
      files.push({ relativePath, absolutePath: full, competitor: relativePath.includes("/") ? relativePath.split("/")[0] : null, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  let status = "ready";
  try { await scan(root); if (!files.length) status = "empty"; }
  catch (error) { if (error.code === "ENOENT") status = "missing"; else throw error; }
  console.log(JSON.stringify({ root, scannedAt: new Date().toISOString(), status, count: files.length, files, skipped }, null, 2));
  if (status !== "ready") process.exitCode = 2;
} catch (error) {
  console.error(`Scene library inventory failed: ${error.message}`);
  process.exitCode = 1;
}
