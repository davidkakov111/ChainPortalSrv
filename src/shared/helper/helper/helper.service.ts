import { Injectable } from '@nestjs/common';
import { NftMetadata } from 'src/shared/interfaces';

@Injectable()
export class HelperService {

    roundUpToDecimals(value: number, decimal: number): number {
        const factor = Math.pow(10, decimal);
        return Math.ceil(value * factor) / factor;
    }

    // Calculate the NFT metadata size in bytes
    calcNftMetadataByteSize(metadata: NftMetadata): number | string {
        const { media, ...metaObj } = metadata;

        // Metadata size in bytes
        const metadataByteSize = new Blob([JSON.stringify(metaObj)]).size; 

        // Media file size in bytes
        let mediaByteSize = 0;
        if (media) {
            if (media instanceof Uint8Array) {
                // For WebSocket binary data
                mediaByteSize = media.byteLength;
            } else {
                console.error('Unsupported media type for the NFT: ', typeof media);
                return 'Unsupported media type for the NFT';
            }
        } else {
            console.error('No media file is provided for the NFT');
            return 'No media file is provided for the NFT';
        }

        return mediaByteSize + metadataByteSize;
    }
}
