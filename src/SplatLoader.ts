import { Loader } from "three";
import { ExtSplats, type ExtSplatsOptions } from "./ExtSplats";
import { SplatMesh } from "./SplatMesh";
import { workerPool } from "./SplatWorker";
import type { SplatFileType } from "./defines";

// SplatLoader implements the THREE.Loader interface for PLY and SPZ files.
export class SplatLoader extends Loader {
  load(
    url: string,
    onLoad?: (decoded: ExtSplats) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    return this.loadInternal({ url, onLoad, onProgress, onError });
  }

  async loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<ExtSplats> {
    return new Promise((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }

  parse(extSplats: ExtSplats): SplatMesh {
    return new SplatMesh({ extSplats });
  }

  loadInternal({
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    stream,
    streamLength,
    onLoad,
    onProgress,
    onError,
  }: {
    extSplats?: ExtSplats;
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    stream?: ReadableStream;
    streamLength?: number;
    onLoad?: (decoded: ExtSplats) => void;
    onProgress?: (event: ProgressEvent) => void;
    onError?: (error: unknown) => void;
  }) {
    const byteArray =
      fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
    const resolvedURL = byteArray
      ? undefined
      : this.manager.resolveURL((this.path ?? "") + (url ?? ""));
    let readStream = stream?.getReader();

    this.manager.itemStart(resolvedURL ?? "");

    workerPool
      .withWorker(async (worker) => {
        const onStatus = async (data: unknown) => {
          const { loaded, total } = data as {
            loaded?: number;
            total?: number;
          };
          if (loaded !== undefined && onProgress) {
            onProgress(
              new ProgressEvent("progress", {
                lengthComputable: total !== 0,
                loaded,
                total: total ?? 0,
              }),
            );
          }

          if ((data as { nextChunk?: boolean }).nextChunk) {
            let chunk: Uint8Array;
            if (!readStream) {
              chunk = new Uint8Array(0);
            } else {
              const { done, value } = await readStream.read();
              if (done) {
                readStream.releaseLock();
                readStream = undefined;
                chunk = new Uint8Array(0);
              } else {
                chunk = value;
              }
            }
            worker.call("nextChunk", { chunk });
          }
        };

        const basedUrl = resolvedURL
          ? new URL(resolvedURL, window.location.href).toString()
          : undefined;
        const decoded = await worker.call(
          "loadExtSplats",
          {
            url: basedUrl,
            requestHeader: this.requestHeader,
            withCredentials: this.withCredentials,
            fileBytes: byteArray?.slice(),
            fileType,
            pathName: resolvedURL || fileName,
            chunked: stream !== undefined,
            chunkedLength: streamLength,
          },
          { onStatus },
        );

        const result = extSplats ?? new ExtSplats();
        result.initialize(decoded as ExtSplatsOptions);
        onLoad?.(result);
      })
      .catch(async (error) => {
        if (readStream) {
          try {
            await readStream.cancel(error);
          } catch {
            // Preserve the worker decoding error if stream cancellation fails.
          }
          readStream.releaseLock();
          readStream = undefined;
        }
        this.manager.itemError(resolvedURL ?? "");
        onError?.(error);
      })
      .finally(() => {
        this.manager.itemEnd(resolvedURL ?? "");
      });
  }

  async loadInternalAsync({
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    stream,
    streamLength,
    onProgress,
  }: {
    extSplats?: ExtSplats;
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    stream?: ReadableStream;
    streamLength?: number;
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<ExtSplats> {
    return new Promise((resolve, reject) => {
      this.loadInternal({
        extSplats,
        url,
        fileBytes,
        fileType,
        fileName,
        stream,
        streamLength,
        onLoad: resolve,
        onProgress,
        onError: reject,
      });
    });
  }
}
