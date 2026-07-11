// Self-goldens: this renderer's output pinned against its own past. Catches
// unintended rendering changes; intentional ones re-bless (npm run bless).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "@classam/marquee-parser";
import { render } from "../src/index.ts";

const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
const goldensPath = fileURLToPath(new URL("../goldens.json", import.meta.url));

const goldens = new Map<string, string>(
  (JSON.parse(readFileSync(goldensPath, "utf8")) as Array<{ name: string; html: string }>).map(
    (g) => [g.name, g.html],
  ),
);

for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort()) {
  const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{
    name: string;
    ast: unknown;
  }>;
  for (const c of cases) {
    test(`golden: ${c.name}`, () => {
      const golden = goldens.get(c.name);
      assert.ok(golden !== undefined, `no golden for ${c.name} - run: npm run bless`);
      assert.equal(render(c.ast as Node), golden);
    });
  }
}
