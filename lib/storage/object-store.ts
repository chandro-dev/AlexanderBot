import { put, head, BlobNotFoundError } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

function useBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function readObject(pathname: string): Promise<Buffer | null> {
  if (useBlobStore()) {
    try {
      const metadata = await head(pathname);
      const response = await fetch(metadata.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Blob read failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      return null;
    }
  }

  try {
    return await readFile(path.join(dataDir, pathname));
  } catch {
    return null;
  }
}

export async function writeObject(pathname: string, body: Buffer | string, contentType: string) {
  if (useBlobStore()) {
    await put(pathname, body, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, pathname), body);
}
