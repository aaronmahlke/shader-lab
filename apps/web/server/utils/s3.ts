import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;
/** Bucket creation is attempted at most once per process. */
let bucketEnsured: Promise<void> | null = null;

/**
 * The SDK throws ERR_INVALID_URL on a scheme-less endpoint, which is an easy
 * env typo ("nbg1.your-objectstorage.com"). Assume https for bare hosts.
 */
function normalizeEndpoint(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
}

function getClient(): S3Client {
  if (!s3Client) {
    const config = useRuntimeConfig();
    s3Client = new S3Client({
      region: config.aws?.region || "us-east-1",
      credentials: {
        accessKeyId: config.aws?.accessKeyId || "any",
        secretAccessKey: config.aws?.secretAccessKey || "any",
      },
      endpoint: normalizeEndpoint(config.aws?.s3Endpoint),
      forcePathStyle: true,
      // SDK >= 3.729 attaches CRC checksums to every PutObject by default;
      // S3-compatible providers (Hetzner, SeaweedFS, …) reject them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return s3Client;
}

export function useS3() {
  const client = getClient();
  const config = useRuntimeConfig();
  const bucket = config.aws?.s3Bucket || "shader-lab";

  /**
   * Nothing in the app or deploy provisions the bucket; dev SeaweedFS
   * auto-creates it on first write but prod S3 answers NoSuchBucket forever
   * (broke every thumbnail/media upload). Create it on demand instead.
   */
  async function ensureBucket(): Promise<void> {
    bucketEnsured ??= (async () => {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.info(`[s3] created missing bucket "${bucket}"`);
      } catch (err) {
        const name = (err as { name?: string })?.name;
        // Racing another instance is fine; anything else should surface.
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
          bucketEnsured = null;
          throw err;
        }
      }
    })();
    await bucketEnsured;
  }

  async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
    const put = () => client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));

    try {
      await put();
    } catch (err) {
      if ((err as { name?: string })?.name !== "NoSuchBucket") throw err;
      await ensureBucket();
      await put();
    }

    // Return the public URL
    const endpoint = normalizeEndpoint(config.aws?.s3Endpoint)
      || `https://s3.${config.aws?.region || "us-east-1"}.amazonaws.com`;
    return `${endpoint}/${bucket}/${key}`;
  }

  async function getObject(key: string): Promise<Buffer> {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    const stream = response.Body;
    if (!stream) throw new Error("Empty response body");
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  return { putObject, getObject };
}
