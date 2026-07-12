// Mirror the object store's generated previews to local disk:
//   s3://$S3_BUCKET/<client>/previews/**  →  storage/<client>/previews/**
// (the same paths local-fs storage mode would have written). Rerunnable:
// downloads missing/changed objects, deletes local files no longer in the
// bucket (gen-previews replaces objects under new keys on every reshoot).
// Run after `npm run gen:previews`: `npm run sync:previews`.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import fs from "node:fs";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getActiveClient } from "../src/lib/active-client";

const BUCKET = process.env.S3_BUCKET;
if (!BUCKET) throw new Error("S3_BUCKET not set — nothing to sync from");
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.cwd(), process.env.STORAGE_ROOT)
  : path.resolve(process.cwd(), "storage");

async function listBucketKeys(prefix: string): Promise<Map<string, number>> {
  const keys = new Map<string, number>();
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) {
      if (o.Key) keys.set(o.Key, o.Size ?? -1);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function listLocalFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listLocalFiles(p));
    else out.push(p);
  }
  return out;
}

async function main() {
  const client = await getActiveClient();
  const prefix = `${client.key}/previews/`;
  const localRoot = path.join(STORAGE_ROOT, client.key, "previews");
  console.log(`Sync s3://${BUCKET}/${prefix} → ${localRoot}`);

  const remote = await listBucketKeys(prefix);
  console.log(`Bucket objects: ${remote.size}`);

  let downloaded = 0;
  let skipped = 0;
  for (const [key, size] of remote) {
    const dest = path.join(STORAGE_ROOT, key);
    if (fs.existsSync(dest) && fs.statSync(dest).size === size) {
      skipped++;
      continue;
    }
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = Buffer.from(await res.Body!.transformToByteArray());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    downloaded++;
  }

  // Local files whose key is gone from the bucket (replaced on reshoot).
  let removed = 0;
  for (const file of listLocalFiles(localRoot)) {
    const key = path.relative(STORAGE_ROOT, file).split(path.sep).join("/");
    if (!remote.has(key)) {
      fs.unlinkSync(file);
      removed++;
    }
  }

  console.log(
    `Done. Downloaded ${downloaded}, up-to-date ${skipped}, removed ${removed} orphan(s).`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
