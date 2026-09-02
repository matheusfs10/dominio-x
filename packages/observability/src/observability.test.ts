import { describe, expect, it } from "vitest";
import { redactUrl, sanitizeErrorMessage } from "./index.js";

describe("observability helpers", () => {
  it("redacts url credentials", () => {
    expect(redactUrl("postgresql://user:secret@host:5432/db")).toBe(
      "postgresql://user:***@host:5432/db",
    );
    expect(redactUrl("not a url")).toBe("[invalid-url]");
  });

  it("sanitizes error messages", () => {
    const msg = sanitizeErrorMessage(
      new Error("request failed api_key=abc123 at redis://u:pw@h:6379"),
    );
    expect(msg).not.toContain("abc123");
    expect(msg).not.toContain("pw@");
    expect(sanitizeErrorMessage("x".repeat(1000)).length).toBe(500);
    expect(sanitizeErrorMessage(undefined)).toBe("Unknown error");
  });
});
