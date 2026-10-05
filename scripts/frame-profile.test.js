import assert from "node:assert/strict";
import test from "node:test";
import { read } from "./test-support/theme-fixtures.js";

test("shared card and PDP previews use slim rails and subtract their actual width from fit limits", () => {
  const css = read("src/theme.css");
  const base = css.match(/\.frame-box \{([^}]+)\}/)[1];
  const hero = css.match(/\.product-gallery-frame \.frame-box \{([^}]+)\}/)[1];
  assert.match(base, /--frame-rail: max\(1px, 1\.5cqw\)/);
  assert.match(base, /border-width: var\(--frame-rail\)/);
  assert.match(base, /88cqw - 2 \* var\(--frame-rail\)/);
  assert.match(base, /86cqh - 2 \* var\(--frame-rail\)/);
  assert.match(hero, /94cqw - 2 \* var\(--frame-rail\)/);
  assert.match(hero, /92cqh - 2 \* var\(--frame-rail\)/);
  assert.match(base, /box-sizing: content-box/);
  assert.match(base, /aspect-ratio: var\(--ar, 0\.8\)/);
  assert.match(base, /border-image-slice: 70/);
  assert.match(base, /border-image-repeat: stretch/);
});

test("no-frame previews stay borderless and use their original contain-fit limits", () => {
  const css = read("src/theme.css");
  const bare = css.match(/\.frame-box\[data-frame="none"\] \{([^}]+)\}/)[1];
  assert.match(bare, /border-width: 0/);
  assert.match(bare, /border-image-source: none/);
  assert.match(bare, /width: min\(88cqw, calc\(86cqh \* var\(--ar, 0\.8\)\)\)/);
  assert.match(css, /\.frame-box\[data-frame="none"\]::after \{ box-shadow: none; \}/);
});
