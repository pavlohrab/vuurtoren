import { describe, expect, it } from "vitest";
import { speedReport, timed } from "./speed.js";

describe("the speed report", () => {
  it("times calls and keeps each function the same on every read", async () => {
    const obj = timed(
      {
        async slow() {
          return 1;
        },
        plain: 3,
        sync: () => 2,
      },
      "t",
    );
    expect(obj.slow).toBe(obj.slow);
    expect(await obj.slow()).toBe(1);
    expect(obj.sync()).toBe(2);
    expect(obj.plain).toBe(3);
    const r = speedReport();
    expect(r).toMatch(/t\.slow/);
    expect(r).toMatch(/t\.sync/);
  });

  it("wraps a frozen object too (the computer app's bridge is frozen)", async () => {
    const frozen = Object.freeze({
      async exec(sql: string) {
        return sql.length;
      },
    });
    const db = timed(frozen, "db");
    expect(await db.exec("abc")).toBe(3);
    expect(speedReport()).toMatch(/db\.exec/);
  });
});
