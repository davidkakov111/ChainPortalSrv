import { Injectable } from '@nestjs/common';
import { createThirdwebClient, ThirdwebClient } from "thirdweb";
import { upload } from "thirdweb/storage";
import { ConfigService } from '@nestjs/config';
import { assetType } from 'src/shared/types';
import { EthereumService } from '../ethereum/ethereum/ethereum.service';
import { NftMetadata } from 'src/shared/interfaces';

@Injectable()
export class ThirdwebService {
    thirdwebClient: ThirdwebClient;
    
    constructor(
        private readonly configSrv: ConfigService,
        private readonly ethereumSrv: EthereumService,
    ) {
        // Create thirdweb client
        const clientId = this.configSrv.get<string>('thirdweb_clinet_id');
        const secretKey = this.configSrv.get<string>('thirdweb_secret_key');
        this.thirdwebClient = createThirdwebClient({clientId, secretKey});     
    }

    // Upload complete NFT metadata (file & metadata) to IPFS
    async uploadNFTMetadataToIPFS(metadataObject: NftMetadata, paymentTxSignature: string): Promise<{successful: boolean, url: string}> {
        const fileUploadResult = await this.uploadMediaToIPFS(metadataObject.media, paymentTxSignature, 'NFT');
        if (!fileUploadResult.successful) {return {successful: false, url: fileUploadResult.fileUrl}};
        
        const metadataUploadResult = await this.uploadMetadataObjToIPFS({
            name: metadataObject.title,
            description: metadataObject.description,
            image: fileUploadResult.fileUrl, 
            ...(metadataObject.externalLink && { external_url: metadataObject.externalLink }),
            ...(metadataObject.attributes?.length && { attributes: metadataObject.attributes.map(({ type, value }) => ({trait_type: type, value}))}),
            ...(metadataObject.symbol && { symbol: metadataObject.symbol }),
            ...(metadataObject.creator && { creator: metadataObject.creator }),
            ...(metadataObject.isLimitedEdition && { isLimitedEdition: metadataObject.isLimitedEdition }),
            ...(metadataObject.totalEditions && { totalEditions: metadataObject.totalEditions }),
            ...(metadataObject.editionNumber && { editionNumber: metadataObject.editionNumber }),
            ...(metadataObject.royalty && { royalty: metadataObject.royalty }),
            ...(metadataObject.tags?.length && { tags: metadataObject.tags }),
            ...(metadataObject.license && { license: metadataObject.license }),
            ...(metadataObject.creationTimestampToggle && { creationTimestamp: metadataObject.creationTimestamp }),
        }, paymentTxSignature, 'NFT');
        return {successful: metadataUploadResult.successful, url: metadataUploadResult.metadataUrl};
    }

    // Upload unit 8 array type media file to IPFS
    async uploadMediaToIPFS(media:  Uint8Array, paymentTxSignature: string, assetType: assetType): Promise<{successful: boolean, fileUrl: string}> {
        try {
            const mediaUrl = await upload({client: this.thirdwebClient, files: [media]});
            if (!mediaUrl) {throw new Error("Uploaded file URL is missing, even though there was no error.")};
            return {successful: true, fileUrl: mediaUrl.replace("ipfs://", "https://ipfs.io/ipfs/")};
        } catch (error) {
            console.error(`Error uploading media file to ipfs via thirdweb: `, error);

            // Redirect the payment
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, assetType);
            if (redirect.isValid) {
                return {successful: false, fileUrl: `Unable to upload media file to IPFS so your payment was redirected after deducting the estimated fee. Please try again.`};
            } else {
                return {successful: false, fileUrl: `Unable to upload media file to IPFS so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Upload metadata object to IPFS
    async uploadMetadataObjToIPFS(metadata: any, paymentTxSignature: string, assetType: assetType): Promise<{successful: boolean, metadataUrl: string}> {
        try {
            const metadataUrl = await upload({client: this.thirdwebClient,
                files: [{name: "metadata.json", data: JSON.stringify(metadata)}]
            });
            if (!metadataUrl) {throw new Error("Uploaded metadata URL is missing, even though there was no error.")}
            return {successful: true, metadataUrl: metadataUrl.replace("ipfs://", "https://ipfs.io/ipfs/")};
        } catch (error) {
            console.error(`Error uploading metadata (${JSON.stringify(metadata)}) to IPFS via thirdweb: `, error);

            // Redirect the payment
            const redirect = await this.ethereumSrv.redirectEthPayment(paymentTxSignature, assetType);
            if (redirect.isValid) {
                return {successful: false, metadataUrl: `Unable to upload metadata to IPFS so your payment was redirected after deducting the estimated fee. Please try again.`};
            } else {
                return {successful: false, metadataUrl: `Unable to upload metadata to IPFS so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }
}
