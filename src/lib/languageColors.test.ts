import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { languageColor, readableInk } from "./languageColors";

const DARK = "#14181a";
const LIGHT = "#f0f2ef";

describe("readableInk", () => {
  it("puts dark ink on the light and mid tones", () => {
    // JavaScript's yellow, Go's cyan and Rust's tan are where white vanishes.
    assert.equal(readableInk(languageColor("JavaScript")), DARK);
    assert.equal(readableInk(languageColor("Go")), DARK);
    assert.equal(readableInk(languageColor("Rust")), DARK);
    // The colour used for unknown languages and for その他.
    assert.equal(readableInk(languageColor(null)), DARK);
  });

  it("puts light ink on the dark end", () => {
    // Lua is navy, Ruby near-maroon, TypeScript a deep blue.
    assert.equal(readableInk(languageColor("Lua")), LIGHT);
    assert.equal(readableInk(languageColor("Ruby")), LIGHT);
    assert.equal(readableInk(languageColor("TypeScript")), LIGHT);
  });

  it("falls back to dark ink on anything that is not a six-digit hex", () => {
    assert.equal(readableInk("rebeccapurple"), DARK);
    assert.equal(readableInk("#fff"), DARK);
  });

  it("never returns the colour it was handed", () => {
    for (const name of ["JavaScript", "Go", "Lua", "Ruby", "TypeScript", "C", "Swift"]) {
      const background = languageColor(name);
      assert.notEqual(readableInk(background).toLowerCase(), background.toLowerCase());
    }
  });
});
