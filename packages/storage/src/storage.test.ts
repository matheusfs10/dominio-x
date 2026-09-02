import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FsObjectStorage, MemoryObjectStorage, assertSafeKey, sha256Hex } from "./index.js";

describe("storage", () => {
  it("memory storage round-trips objects and computes sha256", async () => {
    const s = new MemoryObjectStorage();
    const stored = await s.putObject({
      key: "sources/x/a.txt",
      body: "hello",
      contentType: "text/plain",
    });
    expect(stored.sha256).toBe(sha256Hex("hello"));
    expect((await s.getObjectBuffer({ key: "sources/x/a.txt" })).toString()).toBe("hello");
    expect(await s.headObject({ key: "missing" })).toBeNull();
    expect((await s.headObject({ key: "sources/x/a.txt" }))?.size).toBe(5);
  });

  it("rejects unsafe keys", () => {
    expect(() => assertSafeKey("../etc/passwd")).toThrow();
    expect(() => assertSafeKey("/abs")).toThrow();
    expect(() => assertSafeKey("a//b")).toThrow();
    expect(() => assertSafeKey("sources/registro-br/2026/09/x-abc.txt")).not.toThrow();
  });

  describe("fs storage", () => {
    let dir: string;
    afterAll(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    it("writes under the root and refuses traversal", async () => {
      dir = await mkdtemp(join(tmpdir(), "dx-storage-"));
      const s = new FsObjectStorage(dir);
      await s.putObject({ key: "a/b.txt", body: Buffer.from("x") });
      expect((await s.getObjectBuffer({ key: "a/b.txt" })).toString()).toBe("x");
      expect((await s.headObject({ key: "a/b.txt" }))?.size).toBe(1);
      await expect(s.putObject({ key: "../escape.txt", body: "x" })).rejects.toThrow();
    });
  });
});
