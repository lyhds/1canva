import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./create-product.js", import.meta.url));
// Execute the CLI with an isolated filesystem and mocked network. No store
// credentials are read and no uploads, products or publications are created.
const source = fs.readFileSync(scriptPath, "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("import.meta.url", JSON.stringify(new URL("./create-product.js", import.meta.url).href));

/** Shared context for the legacy CLI: mocked fs, console and Shopify API. */
function cliContext({ argv, onProduct, network = null }) {
  return {
    path, fileURLToPath, Buffer, Blob, FormData,
    console: { log() {}, error() {} },
    process: {
      argv: ["node", scriptPath, ...argv],
      exit(code) { throw new Error(`Unexpected exit ${code}`); },
    },
    fs: {
      existsSync: () => true,
      readdirSync: () => ["master.png"],
      statSync: () => ({ size: 32 }),
      readFileSync: file => path.basename(file) === ".env"
        ? "SHOPIFY_STORE=fixture.invalid\nSHOPIFY_CLIENT_ID=fake\nSHOPIFY_CLIENT_SECRET=fake"
        : Buffer.alloc(32),
    },
    ...(network ? { fetch: network } : {}),
  };
}

for (const [width, height, expectedSizes] of [
  [800, 1000, ["30 × 40 cm", "40 × 50 cm", "50 × 70 cm", "70 × 100 cm", "100 × 150 cm"]],
  [1000, 1000, ["30 × 30 cm", "40 × 40 cm", "50 × 50 cm", "70 × 70 cm", "100 × 100 cm"]],
  [1500, 1000, ["40 × 30 cm", "50 × 40 cm", "70 × 50 cm", "100 × 70 cm", "150 × 100 cm"]],
  [750, 1000, ["30 × 40 cm", "45 × 60 cm", "60 × 80 cm", "75 × 100 cm", "90 × 120 cm"]],
  [2000, 1000, ["40 × 20 cm", "60 × 30 cm", "80 × 40 cm", "100 × 50 cm", "150 × 75 cm"]],
]) {
  test(`product CLI creates matching size options and 20 variants for ${width}:${height}`, async () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(width, 16);
    png.writeUInt32BE(height, 20);
    let productInput;
    let published = false;
    const publish = width === 800;
    const frames = ["Oak frame", "Black frame", "Walnut frame", "No frame"];
    const context = cliContext({
      argv: ["--allow-legacy", "--apply", "--dir", "fixture", "--title", "Test painting", "--master", "master.png", ...(publish ? ["--publish"] : [])],
      network: async (url, options) => {
        const response = data => ({ json: async () => data });
        if (url.endsWith("/oauth/access_token")) return response({ access_token: "fake" });
        if (url === "https://upload.invalid") return { status: 201 };
        const { query, variables } = JSON.parse(options.body);
        if (query.includes("stagedUploadsCreate")) return response({ data: { stagedUploadsCreate: {
          stagedTargets: [{ url: "https://upload.invalid", resourceUrl: "https://image.invalid/master.png", parameters: [] }], userErrors: [],
        } } });
        if (query.includes("mutation productSet")) {
          productInput = variables.input;
          return response({ data: { productSet: { product: { id: "test-product", handle: "test-painting", status: "ACTIVE", variants: { nodes: productInput.variants } }, userErrors: [] } } });
        }
        if (query.includes("publications(first:")) return response({ data: { publications: { nodes: [{ id: "test-channel", name: "Online Store" }] } } });
        if (query.includes("mutation publishablePublish")) {
          assert.deepEqual(variables, { id: "test-product", input: [{ publicationId: "test-channel" }] });
          published = true;
          return response({ data: { publishablePublish: { userErrors: [] } } });
        }
        // read-back of the created product, then of its publication state
        if (query.includes("resourcePublications")) return response({ data: { product: { resourcePublications: { nodes: [{ isPublished: published, publication: { name: "Online Store" } }] } } } });
        if (query.includes("product(id:")) return response({ data: { product: {
          id: "test-product", title: productInput.title, handle: "test-painting", status: "ACTIVE",
          // Shopify returns option values as plain strings, not {name} objects
          options: productInput.productOptions.map(option => ({ name: option.name, values: option.values.map(value => value.name) })),
          variants: { nodes: productInput.variants.map(variant => ({ title: variant.optionValues.map(option => option.name).join(" / ") })) },
          media: { nodes: productInput.files.map(file => ({ alt: file.alt, status: "READY" })) },
        } } });
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    context.fs.readFileSync = file => path.basename(file) === ".env"
      ? "SHOPIFY_STORE=fixture.invalid\nSHOPIFY_CLIENT_ID=fake\nSHOPIFY_CLIENT_SECRET=fake"
      : png;
    await vm.runInNewContext(source, context, { filename: scriptPath });
    assert.ok(productInput, "CLI must reach product creation");
    assert.deepEqual(productInput.productOptions, [
      { name: "Size", values: expectedSizes.map(name => ({ name })) },
      { name: "Frame", values: frames.map(name => ({ name })) },
    ]);
    assert.equal(productInput.variants.length, 20);
    for (const [i, variant] of productInput.variants.entries()) {
      assert.deepEqual(variant.optionValues, [
        { optionName: "Size", name: expectedSizes[Math.floor(i / 4)] },
        { optionName: "Frame", name: frames[i % 4] },
      ]);
      assert.equal(variant.price, ["80.00", "100.00", "140.00", "200.00", "280.00"][Math.floor(i / 4)]);
      assert.equal(variant.inventoryPolicy, "CONTINUE");
    }
    assert.equal(productInput.files[0].alt, "master");
    assert.equal(published, publish);
  });
}

test("a read-back mismatch fails the run instead of reporting success", async () => {
  const context = cliContext({
    argv: ["--allow-legacy", "--apply", "--dir", "fixture", "--title", "Test painting", "--master", "master.png"],
    network: async (url, options) => {
      const response = data => ({ json: async () => data });
      if (url.endsWith("/oauth/access_token")) return response({ access_token: "fake" });
      if (url === "https://upload.invalid") return { status: 201 };
      const { query, variables } = JSON.parse(options.body);
      if (query.includes("stagedUploadsCreate")) return response({ data: { stagedUploadsCreate: {
        stagedTargets: [{ url: "https://upload.invalid", resourceUrl: "https://image.invalid/master.png", parameters: [] }], userErrors: [],
      } } });
      if (query.includes("mutation productSet")) return response({ data: { productSet: {
        product: { id: "test-product", handle: "test-painting", status: "ACTIVE", variants: { nodes: variables.input.variants } }, userErrors: [],
      } } });
      // Shopify reports a different size ladder than the one that was sent
      if (query.includes("product(id:")) return response({ data: { product: {
        id: "test-product", title: "Test painting", status: "ACTIVE",
        options: [{ name: "Size", values: ["40 × 50 cm"] }, { name: "Frame", values: ["Oak frame"] }],
        variants: { nodes: [] }, media: { nodes: [] },
      } } });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  await assert.rejects(vm.runInNewContext(source, context, { filename: scriptPath }), /Unexpected exit 1/);
});

test("without --apply the CLI prints a plan and never contacts Shopify", async () => {
  const logs = [];
  let requests = 0;
  const context = cliContext({
    argv: ["--allow-legacy", "--dir", "fixture", "--title", "Test painting", "--master", "master.png"],
    network: async () => { requests++; throw new Error("no Shopify request expected"); },
  });
  context.console.log = (...args) => logs.push(args.join(" "));
  const png = Buffer.alloc(32);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(1000, 20);
  context.fs.readFileSync = file => path.basename(file) === ".env"
    ? "SHOPIFY_STORE=fixture.invalid\nSHOPIFY_CLIENT_ID=fake\nSHOPIFY_CLIENT_SECRET=fake"
    : png;
  await assert.rejects(vm.runInNewContext(source, context, { filename: scriptPath }), /Unexpected exit 0/);
  assert.equal(requests, 0, "the plan must not touch the network");
  const plan = JSON.parse(logs.find(line => line.trim().startsWith("{")));
  assert.equal(plan.mode, "plan");
  assert.equal(plan.status, "ACTIVE");
  assert.equal(plan.publish, false);
  assert.equal(plan.variants, 20);
  assert.deepEqual(plan.sizes, ["30 × 40 cm", "40 × 50 cm", "50 × 70 cm", "70 × 100 cm", "100 × 150 cm"]);
  assert.deepEqual(plan.uploads, ["master.png"]);
});
