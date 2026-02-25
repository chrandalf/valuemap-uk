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
