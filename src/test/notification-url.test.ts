import { describe, expect, it } from "vitest";
import { isSafeInternalPath } from "@/lib/notification-url";

describe("isSafeInternalPath", () => {
  it("accepts empty optional links and same-origin paths", () => {
    expect(isSafeInternalPath("")).toBe(true);
    expect(isSafeInternalPath("/products?category=tiktok")).toBe(true);
    expect(isSafeInternalPath("/wallet#transactions")).toBe(true);
  });

  it("rejects absolute, protocol-relative, and malformed redirect targets", () => {
    expect(isSafeInternalPath("https://example.com")).toBe(false);
    expect(isSafeInternalPath("//example.com")).toBe(false);
    expect(isSafeInternalPath("/\\example.com")).toBe(false);
    expect(isSafeInternalPath("/safe\nLocation: https://example.com")).toBe(false);
  });
});
