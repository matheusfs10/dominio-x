import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "@dominio-x/config";

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
  etag?: string;
}

export interface GetObjectInput {
  key: string;
}

export interface HeadObjectInput {
  key: string;
}

export interface ObjectMetadata {
  key: string;
  size: number;
  contentType?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface ObjectStorage {
  readonly driver: "s3" | "fs" | "memory";
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(input: GetObjectInput): Promise<Readable>;
  getObjectBuffer(input: GetObjectInput): Promise<Buffer>;
  headObject(input: HeadObjectInput): Promise<ObjectMetadata | null>;
  createPresignedGetUrl(input: { key: string; expiresInSeconds?: number }): Promise<string>;
  healthcheck(): Promise<{ ok: boolean; error?: string }>;
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function toBuffer(body: PutObjectInput["body"]): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from(body);
}

const KEY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]{0,1023}$/;

export function assertSafeKey(key: string): void {
  if (!KEY_REGEX.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe object key: ${key}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests)
// ---------------------------------------------------------------------------
export class MemoryObjectStorage implements ObjectStorage {
  readonly driver = "memory" as const;
  private readonly objects = new Map<
    string,
    { body: Buffer; contentType?: string; metadata?: Record<string, string>; at: Date }
  >();

  putObject(input: PutObjectInput): Promise<StoredObject> {
    assertSafeKey(input.key);
    const body = toBuffer(input.body);
    this.objects.set(input.key, {
      body,
      contentType: input.contentType,
      metadata: input.metadata,
      at: new Date(),
    });
    return Promise.resolve({ key: input.key, size: body.length, sha256: sha256Hex(body) });
  }

  getObject(input: GetObjectInput): Promise<Readable> {
    const obj = this.objects.get(input.key);
    if (!obj) return Promise.reject(new Error(`Object not found: ${input.key}`));
    return Promise.resolve(Readable.from(obj.body));
  }

  getObjectBuffer(input: GetObjectInput): Promise<Buffer> {
    const obj = this.objects.get(input.key);
    if (!obj) return Promise.reject(new Error(`Object not found: ${input.key}`));
    return Promise.resolve(Buffer.from(obj.body));
  }

  headObject(input: HeadObjectInput): Promise<ObjectMetadata | null> {
    const obj = this.objects.get(input.key);
    if (!obj) return Promise.resolve(null);
    return Promise.resolve({
      key: input.key,
      size: obj.body.length,
      contentType: obj.contentType,
      lastModified: obj.at,
      metadata: obj.metadata,
    });
  }

  createPresignedGetUrl(input: { key: string }): Promise<string> {
    return Promise.resolve(`memory://${input.key}`);
  }

  healthcheck(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

// ---------------------------------------------------------------------------
// Local filesystem (development only)
// ---------------------------------------------------------------------------
export class FsObjectStorage implements ObjectStorage {
  readonly driver = "fs" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep) && full !== this.root)
      throw new Error("Path traversal rejected");
    return full;
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const body = toBuffer(input.body);
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(
      `${path}.meta.json`,
      JSON.stringify({ contentType: input.contentType, metadata: input.metadata }),
    );
    return { key: input.key, size: body.length, sha256: sha256Hex(body) };
  }

  async getObject(input: GetObjectInput): Promise<Readable> {
    return Readable.from(await readFile(this.pathFor(input.key)));
  }

  getObjectBuffer(input: GetObjectInput): Promise<Buffer> {
    return readFile(this.pathFor(input.key));
  }

  async headObject(input: HeadObjectInput): Promise<ObjectMetadata | null> {
    try {
      const path = this.pathFor(input.key);
      const s = await stat(path);
      let meta: { contentType?: string; metadata?: Record<string, string> } = {};
      try {
        meta = JSON.parse(await readFile(`${path}.meta.json`, "utf8")) as typeof meta;
      } catch {
        /* ignore */
      }
      return {
        key: input.key,
        size: s.size,
        lastModified: s.mtime,
        contentType: meta.contentType,
        metadata: meta.metadata,
      };
    } catch {
      return null;
    }
  }

  createPresignedGetUrl(input: { key: string }): Promise<string> {
    return Promise.resolve(`file://${this.pathFor(input.key)}`);
  }

  async healthcheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "unknown" };
    }
  }
}

// ---------------------------------------------------------------------------
// S3-compatible (Railway Storage Bucket, MinIO, AWS)
// ---------------------------------------------------------------------------
export interface S3StorageOptions {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3" as const;
  private readonly bucket: string;
  private clientPromise: Promise<S3Client> | null = null;
  private readonly options: S3StorageOptions;

  constructor(options: S3StorageOptions) {
    this.options = options;
    this.bucket = options.bucket;
  }

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        return new S3Client({
          endpoint: this.options.endpoint,
          region: this.options.region ?? "auto",
          forcePathStyle: this.options.forcePathStyle ?? false,
          credentials: {
            accessKeyId: this.options.accessKeyId,
            secretAccessKey: this.options.secretAccessKey,
          },
        });
      })();
    }
    return this.clientPromise;
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    assertSafeKey(input.key);
    const body = toBuffer(input.body);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (
      await this.client()
    ).send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
    return { key: input.key, size: body.length, sha256: sha256Hex(body), etag: res.ETag };
  }

  async getObject(input: GetObjectInput): Promise<Readable> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (
      await this.client()
    ).send(new GetObjectCommand({ Bucket: this.bucket, Key: input.key }));
    if (!res.Body) throw new Error(`Object not found: ${input.key}`);
    return res.Body as Readable;
  }

  async getObjectBuffer(input: GetObjectInput): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (
      await this.client()
    ).send(new GetObjectCommand({ Bucket: this.bucket, Key: input.key }));
    if (!res.Body) throw new Error(`Object not found: ${input.key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async headObject(input: HeadObjectInput): Promise<ObjectMetadata | null> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (
        await this.client()
      ).send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.key }));
      return {
        key: input.key,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified,
        metadata: res.Metadata,
      };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") return null;
      throw error;
    }
  }

  async createPresignedGetUrl(input: { key: string; expiresInSeconds?: number }): Promise<string> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      await this.client(),
      new GetObjectCommand({ Bucket: this.bucket, Key: input.key }),
      {
        expiresIn: input.expiresInSeconds ?? 300,
      },
    );
  }

  async healthcheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
      await (await this.client()).send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.name : "unknown" };
    }
  }
}

export function createObjectStorage(config: StorageConfig): ObjectStorage {
  switch (config.STORAGE_DRIVER) {
    case "memory":
      return new MemoryObjectStorage();
    case "fs":
      return new FsObjectStorage(config.STORAGE_FS_ROOT);
    case "s3":
      return new S3ObjectStorage({
        endpoint: config.S3_ENDPOINT!,
        accessKeyId: config.S3_ACCESS_KEY_ID!,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
        bucket: config.S3_BUCKET!,
        region: config.S3_REGION,
        forcePathStyle: config.S3_URL_STYLE === "path",
      });
  }
}
