import { put, get } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function useBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function dataDir() {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "appfinanzas");
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

export function storageMode() {
  if (useBlobStore()) return "vercel-blob";
  if (process.env.VERCEL) return "serverless-tmp";
  return "local-filesystem";
}

export async function readObject(pathname: string): Promise<Buffer | null> {
  if (useBlobStore()) {
    const blob = await get(pathname, { access: "private", useCache: false });
    if (!blob || blob.statusCode === 304 || !blob.stream) return null;

    const reader = blob.stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  try {
    return await readFile(path.join(dataDir(), pathname));
  } catch {
    return null;
  }
}

export async function writeObject(pathname: string, body: Buffer | string, contentType: string) {
  if (useBlobStore()) {
    await put(pathname, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }

  await mkdir(dataDir(), { recursive: true });
  await writeFile(path.join(dataDir(), pathname), body);
}
