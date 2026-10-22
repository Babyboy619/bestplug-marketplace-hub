import { describe, expect, it } from "vitest";
import { splitInventoryLines } from "@/lib/admin-inventory";

describe("plain inventory logs", () => {
  it("creates one exact record per nonblank line without parsing punctuation", () => {
    expect(
      splitInventoryLines(
        "  ID: 22334455 | Password: 123456  \r\nusername123:password789\nFacebook USA account - ID 123456\n",
      ),
    ).toEqual([
      "ID: 22334455 | Password: 123456",
      "username123:password789",
      "Facebook USA account - ID 123456",
    ]);
  });

  it("ignores blank lines and accepts any non-whitespace line", () => {
    expect(splitInventoryLines("\n hello \n   \nlog two\n\n")).toEqual(["hello", "log two"]);
  });

  it("keeps an empty input empty", () => {
    expect(splitInventoryLines(" \r\n\t\n")).toEqual([]);
  });
});
