import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { uploadFile } from "@/lib/entities/files";
import { readFileBytes, deleteStorageFile } from "@/lib/storage";
import { withActiveClientKey, createTestDb, type TestDb } from "../../helpers/test-db";

// In-memory stand-in for the object store, keyed by S3 object key.
const store = new Map<string, Buffer>();

// Mock the AWS SDK so the S3 driver path runs WITHOUT touching real MinIO.
// This locks the contract: S3 selected when S3_BUCKET is set, the object key
// equals storagePath, and put/get/delete round-trip.
vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(public input: { Bucket: string; Key: string; Body: Buffer }) {}
    __t = "put";
  }
  class GetObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
    __t = "get";
  }
  class DeleteObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
    __t = "del";
  }
  class S3Client {
    constructor(public cfg: unknown) {}
    async send(cmd: { __t: string; input: { Key: string; Body?: Buffer } }) {
      const key = cmd.input.Key;
      if (cmd.__t === "put") {
        store.set(key, Buffer.from(cmd.input.Body as Buffer));
        return {};
      }
      if (cmd.__t === "get") {
        const b = store.get(key);
        if (!b) {
          const e = new Error("NoSuchKey") as Error & { name: string };
          e.name = "NoSuchKey";
          throw e;
        }
        return { Body: { transformToByteArray: async () => new Uint8Array(b) } };
      }
      store.delete(key); // delete is idempotent
      return {};
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=",
  "base64",
);

let h: TestDb;
let erste: { id: number; key: string };

beforeEach(async () => {
  store.clear();
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY_ID = "test";
  process.env.S3_SECRET_ACCESS_KEY = "test";
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
  // Critical: don't leak S3 mode into other (fs-mode) test files.
  delete process.env.S3_BUCKET;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

describe("S3 object-store driver", () => {
  it("writes source bytes to the bucket under storagePath and reads them back", async () => {
    withActiveClientKey("erste");
    const row = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "banner.png",
      mimeType: "image/png",
      category: "creative",
      uploadedBy: "u1",
    });
    // The object key is exactly the relative storagePath.
    expect(store.has(row.storagePath)).toBe(true);
    expect(row.storagePath).toMatch(/^erste\/creatives\/\d{4}\/\d{2}\//);

    const bytes = await readFileBytes(row.storagePath);
    expect(bytes.equals(TINY_PNG)).toBe(true);
  });

  it("intra-client dedup stores the bytes once", async () => {
    withActiveClientKey("erste");
    const a = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "a.png",
      mimeType: "image/png",
      category: "creative",
      uploadedBy: "u1",
    });
    const b = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "b.png",
      mimeType: "image/png",
      category: "creative",
      uploadedBy: "u1",
    });
    expect(b.storagePath).toBe(a.storagePath);
    expect(store.size).toBe(1);
  });

  it("deleteStorageFile removes the object", async () => {
    withActiveClientKey("erste");
    const row = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "x.png",
      mimeType: "image/png",
      category: "creative",
      uploadedBy: "u1",
    });
    expect(store.has(row.storagePath)).toBe(true);
    await deleteStorageFile(row.storagePath);
    expect(store.has(row.storagePath)).toBe(false);
  });

  it("rejects path traversal in object keys", async () => {
    await expect(readFileBytes("../../etc/passwd")).rejects.toThrow(
      /Invalid storage path/,
    );
  });
});
