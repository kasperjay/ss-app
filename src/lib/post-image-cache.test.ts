import { describe, it, expect } from "vitest";
import { allowedImageUrl, readPostImage, savePostImage } from "./post-image-cache";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

describe("post image persistence", () => {
  it("rejects misleading hosts and unsafe protocols", () => {
    for (const url of ["http://cdninstagram.com/a", "https://evil.test/cdninstagram.com", "https://cdninstagram.com.evil.test/a", "https://user@cdninstagram.com/a"]) expect(allowedImageUrl(url)).toBe(false);
    expect(allowedImageUrl("https://scontent.cdninstagram.com/a")).toBe(true);
  });
  it("retains image bytes independently of the upstream URL", async () => {
    const key = `test:${randomUUID()}`;
    expect(await readPostImage(key)).toBe(null);
    const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const saved = await savePostImage(key, new Uint8Array(source).buffer);
    expect(await readPostImage(key)).toEqual(saved);
    expect((await sharp(saved).metadata()).format).toBe("webp");
  });
  it("does not persist invalid responses", async () => {
    const key = `test:${randomUUID()}`;
    await expect(savePostImage(key, new TextEncoder().encode("login required").buffer)).rejects.toThrow();
    expect(await readPostImage(key)).toBe(null);
  });
});
