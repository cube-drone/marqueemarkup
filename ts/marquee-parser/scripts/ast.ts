// Differential-fuzzing parity CLI: read a JSON array of Marquee inputs on
// stdin, emit a JSON array of results on stdout - {"ast": ...} for a parse,
// {"error": "..."} for a version refusal, {"panic": true} if the parser
// blew up (which is itself a conformance failure: parse is total).

import { readFileSync } from "node:fs";
import { parse, UnsupportedVersionError } from "../src/index.ts";

const inputs = JSON.parse(readFileSync(0, "utf8")) as string[];

const results = inputs.map((doc) => {
  try {
    return { ast: parse(doc) };
  } catch (e) {
    if (e instanceof UnsupportedVersionError) {
      return { error: e.message };
    }
    return { panic: true };
  }
});

process.stdout.write(JSON.stringify(results) + "\n");
