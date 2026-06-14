import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    const config = useRuntimeConfig();
    s3Client = new S3Client({
      region: config.aws?.region || "us-east-1",
      credentials: {
        accessKeyId: config.aws?.accessKeyId || "any",
        secretAccessKey: config.aws?.secretAccessKey || "any",
      },
      endpoint: config.aws?.s3Endpoint || undefined,
      forcePathStyle: true,
    });
  }
  return s3Client;
}

export function useS3() {
  const client = getClient();
  const config = useRuntimeConfig();
  const bucket = config.aws?.s3Bucket || "shader-lab";

  async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));

    // Return the public URL
    const endpoint = config.aws?.s3Endpoint || `https://s3.${config.aws?.region || "us-east-1"}.amazonaws.com`;
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
