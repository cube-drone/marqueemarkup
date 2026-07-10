// Regenerate this renderer's self-goldens: render every vector case's AST
// and record the HTML. These police *this renderer's yesterday* (regression),
// not the other renderer's bytes - renderers may differ, per spec.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "../../parser/src/index.ts";
import { render } from "../src/index.ts";

const vectorsDir = fileURLToPath(new URL("../../../vectors/", import.meta.url));
const out: Array<{ name: string; html: string }> = [];

for (const file of readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort()) {
  const cases = JSON.parse(readFileSync(join(vectorsDir, file), "utf8")) as Array<{
    name: string;
    ast: unknown;
  }>;
  for (const c of cases) {
    out.push({ name: c.name, html: render(c.ast as Node) });
  }
}

const goldensPath = fileURLToPath(new URL("../goldens.json", import.meta.url));
writeFileSync(goldensPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`blessed ${out.length} goldens -> goldens.json`);
