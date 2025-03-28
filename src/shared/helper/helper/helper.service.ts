import { Injectable } from '@nestjs/common';
import { NftMetadata, TokenMetadata } from 'src/shared/interfaces';

@Injectable()
export class HelperService {

    roundUpToDecimals(value: number, decimal: number): number {
        const factor = Math.pow(10, decimal);
        return Math.ceil(value * factor) / factor;
    }

    // Calculate the NFT or Token metadata size in bytes
    calcMetadataByteSize(metadata: NftMetadata | {name: string, symbol: string, description: string, image: string, media:  Uint8Array | null}): number | string {
        const { media, ...metaObj } = metadata;

        // Metadata size in bytes
        const metadataByteSize = new Blob([JSON.stringify(metaObj)]).size; 

        // Media file size in bytes
        let mediaByteSize = this.calcMediaByteSize(media);
        if (typeof mediaByteSize === 'string') return mediaByteSize;
        
        return mediaByteSize + metadataByteSize;
    }

    // Calculate the size in bytes of an Unit8Array media file 
    calcMediaByteSize(mediaFile: Uint8Array): number | string {
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

    // Validate token metadata
    validateTokenMetadata(metadata: TokenMetadata): {success: boolean, error: string} {
        if (!metadata.name || metadata.name.length > 32) {
            return {success: false, error: 'Token name is required and should be less then 32 character long.'};
        } else if (!metadata.symbol || metadata.symbol.length > 10) {
            return {success: false, error: 'Token symbol is required and should be less then 10 character long.'};
        } else if (!metadata.media) {
            return {success: false, error: 'Token icon media is required.'};
        } else if (metadata.supply === 0 || metadata.supply && (metadata.supply < 1 || metadata.supply > 1e19)) {
            return {success: false, error: 'Token supply should be positive number and max 1e19.'};
        } else if (metadata.decimals && (metadata.decimals < 0 || metadata.decimals > 9)) {
            return {success: false, error: 'Token decimal should not be negative number and more then 9.'};
        }
        return {success: true, error: ''};
    }

    // Validate NFT metadata
    validateNFTMetadata(metadata: NftMetadata): {success: boolean, error: string} {
        if (!metadata.title || metadata.title.length > 32) {
            return {success: false, error: 'NFT name is required and should be less then 32 character long.'};
        } else if (!metadata.description) {
            return {success: false, error: 'NFT description is required.'};
        } else if (!metadata.media) {
            return {success: false, error: 'NFT media file is required.'};
        } else if (metadata.attributes) {
            if (metadata.attributes.length > 6) {
                return {success: false, error: 'NFT attributes shoud not be more then 6.'};
            }
            for (let i of metadata.attributes) {
                if (i.type.length > 32 || i.value.length > 64) {
                    return {success: false, error: "NFT attribute type shouldn\'t be longer then 32 and value shoudn\'t be longer then 64."};
                }
            }
        }
        
        // validate attributes type and value length 
        return {success: true, error: ''};
    }
}
