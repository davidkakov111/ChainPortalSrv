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
        let mediaByteSize = this.calcNftMediaByteSize(media);
        if (typeof mediaByteSize === 'string') return mediaByteSize;
        
        return mediaByteSize + metadataByteSize;
    }

    // Calculate the size in bytes of an Unit8Array media file 
    calcNftMediaByteSize(mediaFile: Uint8Array): number | string {
        // Media file size in bytes
        let mediaByteSize = 0;
        if (mediaFile) {
            if (mediaFile instanceof Uint8Array) {
                // For WebSocket binary data
                mediaByteSize = mediaFile.byteLength;
            } else {
                console.error('Unsupported media type for the NFT: ', typeof mediaFile);
                return 'Unsupported media type for the NFT';
            }
        } else {
            console.error('No media file is provided for the NFT');
            return 'No media file is provided for the NFT';
        }

        return mediaByteSize;
    }
}
