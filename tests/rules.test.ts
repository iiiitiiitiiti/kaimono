import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STORE_MAX, WEBHOOK_PATTERN } from "../src/model";

const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");

describe("firestore.rules", () => {
  it("お店の名前の長さの上限がアプリと揃っている", () => {
    const m = rules.match(/function validSection\(v\) \{\s*return shortString\(v, 1, (\d+)\);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(STORE_MAX);
  });

  it("Discord のウェブフック URL の形がアプリと揃っている", () => {
    expect(rules).toContain(`d.discord.matches("${WEBHOOK_PATTERN}")`);
  });
});
