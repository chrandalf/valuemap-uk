export async function gunzipToString(buffer: ArrayBuffer): Promise<string> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });

  const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(decompressedStream).text();
}

export function gunzipStream(stream: ReadableStream<unknown>): ReadableStream<Uint8Array> {
  const input = stream as ReadableStream<Uint8Array<ArrayBufferLike>>;
  const decompressor = new DecompressionStream("gzip") as unknown as TransformStream<
    Uint8Array<ArrayBufferLike>,
    Uint8Array
  >;
  return input.pipeThrough(decompressor);
}
