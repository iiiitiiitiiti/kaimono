import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS } from "../src/model";

describe("firestore.rules", () => {
  it("売り場の一覧がアプリと揃っている", () => {
    const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
    const m = rules.match(/function validSection\(v\) \{\s*return v in \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const listed = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(listed).toEqual([...SECTIONS]);
  });
});
