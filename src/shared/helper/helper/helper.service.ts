import { Injectable } from '@nestjs/common';
import { NftMetadata } from 'src/shared/interfaces';

@Injectable()
export class HelperService {

    roundUpToDecimals(value: number, decimal: number): number {
        const factor = Math.pow(10, decimal);
        return Math.ceil(value * factor) / factor;
    }

    // Calculate the NFT metadata size in bytes
    async calcNftMetadataByteSize(metadata: NftMetadata) {
        const { media, ...metaObj } = metadata;

        // Metadata size in bytes
        const metadataByteSize = new Blob([JSON.stringify(metaObj)]).size; 

        // Media file size in bytes
        const arrayBuffer = await media?.arrayBuffer();
        const mediaByteSize = arrayBuffer?.byteLength ?? 0; 

        return mediaByteSize + metadataByteSize;
    }
}
