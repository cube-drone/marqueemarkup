// Conformance runner: every {name, marquee, ast} case in ../../vectors/*.json
// must parse to structural equality. Identical corpus, independent
// implementation - this file is the differential test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/index.ts";

const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
const files = readdirSync(vectorsDir)
  .filter((f) => f.endsWith(".json"))
  .sort();
assert.ok(files.length > 0, `no vector files found in ${vectorsDir}`);

for (const file of files) {
  const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{
    name: string;
    marquee: string;
    ast: unknown;
  }>;
  for (const c of cases) {
    test(c.name, () => {
      assert.deepStrictEqual(parse(c.marquee), c.ast);
    });
  }
}
