import { Loader } from 'three';
import { ExtSplats } from './ExtSplats';
import { SplatMesh } from './SplatMesh';
import { SplatFileType } from './defines';
export declare class SplatLoader extends Loader {
    load(url: string, onLoad?: (decoded: ExtSplats) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<ExtSplats>;
    parse(extSplats: ExtSplats): SplatMesh;
    loadInternal({ extSplats, url, fileBytes, fileType, fileName, stream, streamLength, onLoad, onProgress, onError, }: {
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
    }): void;
    loadInternalAsync({ extSplats, url, fileBytes, fileType, fileName, stream, streamLength, onProgress, }: {
        extSplats?: ExtSplats;
        url?: string;
        fileBytes?: Uint8Array | ArrayBuffer;
        fileType?: SplatFileType;
        fileName?: string;
        stream?: ReadableStream;
        streamLength?: number;
        onProgress?: (event: ProgressEvent) => void;
    }): Promise<ExtSplats>;
}
