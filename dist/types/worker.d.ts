import { ExtResult } from './defines';
declare const rpcHandlers: {
    setSortCenters: typeof setSortCenters;
    sortCenters32: typeof sortCenters32;
    loadExtSplats: typeof loadExtSplats;
    nextChunk: typeof nextChunk;
};
export type RpcHandlers = typeof rpcHandlers;
declare function setSortCenters({ centers, rangeBases, rangeCounts, rangeOrigins, }: {
    centers: Float32Array;
    rangeBases: Uint32Array;
    rangeCounts: Uint32Array;
    rangeOrigins: Float64Array;
}): {
    numSplats: number;
};
declare function sortCenters32({ numSplats, cameraPosition, direction, radial, ordering, }: {
    numSplats: number;
    cameraPosition: [number, number, number];
    direction: [number, number, number];
    radial: boolean;
    ordering: Uint32Array;
}): {
    activeSplats: number;
    ordering: Uint32Array<ArrayBufferLike>;
};
declare function loadExtSplats({ url, requestHeader, withCredentials, fileBytes, fileType, pathName, chunked, chunkedLength, }: {
    url?: string;
    requestHeader?: Record<string, string>;
    withCredentials?: boolean;
    fileBytes?: Uint8Array;
    fileType?: string;
    pathName?: string;
    chunked?: boolean;
    chunkedLength?: number;
}, { sendStatus }: {
    sendStatus: (data: unknown) => void;
}): Promise<ExtResult>;
declare function nextChunk({ chunk }: {
    chunk: Uint8Array;
}): Promise<void>;
export {};
