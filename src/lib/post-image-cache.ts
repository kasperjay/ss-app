import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const directory = path.join(process.cwd(), "data", "post-images");
const filename = (key: string) => path.join(directory, createHash("sha256").update(key).digest("hex") + ".webp");

export async function readPostImage(key: string) {
  try { return await readFile(filename(key)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function savePostImage(key: string, bytes: ArrayBuffer) {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Image exceeds size limit");
  const image = await sharp(Buffer.from(bytes), { limitInputPixels: 40000000 })
    .resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  await mkdir(directory, { recursive: true });
  const target = filename(key);
  const temporary = target + "." + randomUUID();
  await writeFile(temporary, image);
  await rename(temporary, target);
  return image;
}

export function allowedImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      ["fbcdn.net", "instagram.com", "fbsbx.com", "cdninstagram.com", "scdn.co", "spotifycdn.com", "spotify.com", "image.lnk.to", "images.unsplash.com", "picsum.photos", "images.weserv.nl", "imgix.net"]
        .some(domain => url.hostname === domain || url.hostname.endsWith("." + domain));
  } catch { return false; }
}

export async function capturePostImage(key: string, url: string) {
  if (await readPostImage(key) || !allowedImageUrl(url)) return;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Image fetch returned ${response.status}`);
  await savePostImage(key, await response.arrayBuffer());
}
