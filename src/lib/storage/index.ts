/**
 * Storage abstraction | swap provider via STORAGE_PROVIDER env var.
 *
 * Active provider: 's3' pointing at Cloudflare R2 (migrated 2026-08-05).
 * Leave STORAGE_PROVIDER unset to fall back to Supabase Storage.
 *
 * S3-compatible:   STORAGE_PROVIDER=s3
 *                  STORAGE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
 *                  STORAGE_S3_REGION=auto
 *                  STORAGE_S3_ACCESS_KEY_ID=...
 *                  STORAGE_S3_SECRET_ACCESS_KEY=...
 *                  STORAGE_S3_BUCKET_TENANT_ASSETS=xmartmenu-tenant-assets
 *                  STORAGE_S3_BUCKET_PRODUCT_IMAGES=xmartmenu-product-images
 *                  STORAGE_S3_PUBLIC_URL_BASE=https://{bucket}.skale.club
 *
 * The {bucket} placeholder in STORAGE_S3_PUBLIC_URL_BASE is substituted with the
 * resolved bucket name, so one env var covers both buckets. Each bucket is served
 * by an R2 custom domain of the same name on the skale.club Cloudflare zone —
 * public reads are cached at the edge and R2 egress is free.
 *
 * Rollback: unset STORAGE_PROVIDER to write to Supabase again. Objects already
 * written to R2 keep serving from their absolute URLs stored in the DB.
 *
 * Note: R2 has no per-object ACLs. It accepts and ignores an S3 ACL param, so
 * sending one is a silent no-op that reads as if it controlled visibility.
 * Objects are public because the bucket has a custom domain attached.
 */

import { createServiceClient } from '@/lib/supabase/server'

// ─── Bucket type ─────────────────────────────────────────────────────────────

export type StorageBucket = 'tenant-assets' | 'product-images'

// ─── Interface ───────────────────────────────────────────────────────────────

export interface IStorageClient {
  /** Upload a buffer and return the public URL. */
  upload(
    bucket: StorageBucket,
    path: string,
    data: Buffer | Uint8Array,
    options: { contentType: string; upsert?: boolean },
  ): Promise<string>

  /** Get the public URL for an existing object (no network call). */
  getPublicUrl(bucket: StorageBucket, path: string): string

  /** Download an object as a Buffer. */
  download(bucket: StorageBucket, path: string): Promise<Buffer>

  /**
   * Create a signed upload URL for direct browser upload.
   * Used by ocr-upload-token to bypass Vercel's 4.5 MB body limit.
   */
  createSignedUploadUrl(
    bucket: StorageBucket,
    path: string,
    expiresIn?: number,
  ): Promise<{ url: string; token?: string }>
}

// ─── Supabase implementation ──────────────────────────────────────────────────

class SupabaseStorageClient implements IStorageClient {
  async upload(
    bucket: StorageBucket,
    path: string,
    data: Buffer | Uint8Array,
    options: { contentType: string; upsert?: boolean },
  ): Promise<string> {
    const service = await createServiceClient()
    const { data: uploadData, error } = await service.storage
      .from(bucket)
      .upload(path, data, {
        contentType: options.contentType,
        upsert: options.upsert ?? true,
      })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)
    const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(uploadData.path)
    return publicUrl
  }

  getPublicUrl(bucket: StorageBucket, path: string): string {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
  }

  async download(bucket: StorageBucket, path: string): Promise<Buffer> {
    const service = await createServiceClient()
    const { data, error } = await service.storage.from(bucket).download(path)
    if (error) throw new Error(`Storage download failed: ${error.message}`)
    return Buffer.from(await data.arrayBuffer())
  }

  async createSignedUploadUrl(
    bucket: StorageBucket,
    path: string,
    _expiresIn = 300,
  ): Promise<{ url: string; token?: string }> {
    const service = await createServiceClient()
    // Note: this version of @supabase/storage-js only accepts { upsert?: boolean }
    // expiresIn is not configurable on the Supabase provider
    const { data, error } = await service.storage
      .from(bucket)
      .createSignedUploadUrl(path)
    if (error) throw new Error(`Signed URL failed: ${error.message}`)
    return { url: data.signedUrl, token: data.token }
  }
}

// ─── S3 implementation (Hetzner / AWS / Cloudflare R2 / Backblaze B2) ────────

class S3StorageClient implements IStorageClient {
  private endpoint = process.env.STORAGE_S3_ENDPOINT!
  private region = process.env.STORAGE_S3_REGION ?? 'auto'
  private accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID!
  private secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY!
  private publicUrlBase = process.env.STORAGE_S3_PUBLIC_URL_BASE!

  private bucketName(bucket: StorageBucket): string {
    if (bucket === 'tenant-assets') {
      return process.env.STORAGE_S3_BUCKET_TENANT_ASSETS ?? 'xmartmenu-tenant-assets'
    }
    return process.env.STORAGE_S3_BUCKET_PRODUCT_IMAGES ?? 'xmartmenu-product-images'
  }

  private async getS3Client() {
    // Lazy import so @aws-sdk/client-s3 is not bundled when STORAGE_PROVIDER=supabase
    const { S3Client } = await import('@aws-sdk/client-s3')
    return new S3Client({
      endpoint: this.endpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      forcePathStyle: true, // required for Hetzner and most non-AWS S3 providers
      // A stuck request must fail, never hang. The SDK ships with no request
      // timeout and a 50-socket pool, so one socket that is never released stays
      // checked out for the life of the process; enough of them and every later
      // call queues behind them with nothing to break the wait.
      requestHandler: {
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
        httpsAgent: { maxSockets: 200 },
      },
    })
  }

  async upload(
    bucket: StorageBucket,
    path: string,
    data: Buffer | Uint8Array,
    options: { contentType: string; upsert?: boolean },
  ): Promise<string> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.getS3Client()
    const bucketName = this.bucketName(bucket)
    // No ACL param: R2 ignores it, so sending 'public-read' would falsely imply
    // per-object ACLs govern visibility. Public access comes from the bucket's
    // attached custom domain. (Kept S3-portable: AWS defaults to private, which
    // is the safe failure mode if this ever points at a real S3 bucket.)
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: path,
      Body: data,
      ContentType: options.contentType,
    }))
    return this.getPublicUrl(bucket, path)
  }

  getPublicUrl(bucket: StorageBucket, path: string): string {
    const base = this.publicUrlBase.replace('{bucket}', this.bucketName(bucket))
    return `${base}/${path}`
  }

  async download(bucket: StorageBucket, path: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.getS3Client()
    const response = await client.send(new GetObjectCommand({
      Bucket: this.bucketName(bucket),
      Key: path,
    }))
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async createSignedUploadUrl(
    bucket: StorageBucket,
    path: string,
    expiresIn = 300,
  ): Promise<{ url: string; token?: string }> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
    const client = await this.getS3Client()
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: path }),
      { expiresIn },
    )
    return { url }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _client: IStorageClient | null = null

/**
 * Returns the active storage client. Cached per process.
 * Switch provider by setting STORAGE_PROVIDER=s3 (or leave unset for Supabase).
 */
export function getStorageClient(): IStorageClient {
  if (!_client) {
    _client = process.env.STORAGE_PROVIDER === 's3'
      ? new S3StorageClient()
      : new SupabaseStorageClient()
  }
  return _client
}

/** Reset cached client (for testing or hot-reload). */
export function resetStorageClient(): void {
  _client = null
}
