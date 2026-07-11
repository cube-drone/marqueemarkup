#!/usr/bin/env node
// The marquee CLI: one file to a page, or one folder to a website.
//
//     marquee hello.mq > hello.html      a self-contained page on stdout
//     marquee hello.mq -o hello.html     or written to a file
//     marquee site/ dist/                a whole site (shared includes,
//                                        per-site font subsetting)
//
// Batteries included, no surprises: by default the CLI runs the turbolink
// fetch-ahead pass (OpenGraph summaries for bare web links). --nofetch
// produces the spartan, zero-network output instead.

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { buildSite, buildSiteFetch, marquee, marqueeFetch } from "../src/index.ts";

// Piping into `head` is not an emergency.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
  throw err;
});

function usage(): never {
  console.error(
    [
      "usage:",
      "  marquee <file.mq> [-o out.html]   render one self-contained page",
      "  marquee <site-dir> <out-dir>      build a whole site",
      "  --nofetch                         skip the fetch-ahead pass (no network,",
      "                                    web turbolinks stay plain links)",
    ].join("\n"),
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const positional: string[] = [];
let outFile: string | null = null;
let fetchMode = true;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "-o") {
    outFile = args[++i] ?? null;
    if (outFile === null) {
      usage();
    }
    continue;
  }
  if (args[i] === "--nofetch") {
    fetchMode = false;
    continue;
  }
  positional.push(args[i]!);
}
if (positional.length === 0 || positional.length > 2) {
  usage();
}

const [input, outDir] = positional;
const isDir = (() => {
  try {
    return statSync(input!).isDirectory();
  } catch {
    console.error(`marquee: ${input}: not found`);
    process.exit(1);
  }
})();

if (isDir) {
  if (outDir === undefined) {
    usage();
  }
  const report = fetchMode ? await buildSiteFetch(input!, outDir) : buildSite(input!, outDir);
  console.error(
    `built ${report.pages.length} pages (${report.pages.join(", ")}) + ${report.mediaFiles} media files + ${report.fontFaces.length} font faces -> ${report.outDir}`,
  );
} else {
  if (outDir !== undefined) {
    usage();
  }
  const source = readFileSync(input!, "utf8");
  const page = fetchMode ? await marqueeFetch(source) : marquee(source);
  if (outFile === null) {
    process.stdout.write(page);
  } else {
    writeFileSync(outFile, page);
    console.error(`wrote ${outFile}`);
  }
}
