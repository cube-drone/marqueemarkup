# Licensing

Matched to each artifact's adoption physics:

- **SPEC.md and everything in `vectors/`: CC0.** A conformance boundary that isn't freely
  implementable isn't one. Independent implementations are the goal, not a leak.
- **Reference parsers (this repo's code): MPL-2.0** (the `LICENSE` file). Weak copyleft,
  file-scoped: embeddable in any client - proprietary, GPL, or otherwise - without infecting
  the host, while changes to the parser itself stay open. (Chosen over LGPL because Rust's
  static linking makes LGPL's relink clause miserable; MPL is the Rust ecosystem's
  weak-copyleft standard.)
