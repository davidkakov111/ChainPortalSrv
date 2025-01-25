import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { Attribute, cliEnv, NftMetadata } from 'src/shared/interfaces';
import { SolanaHelpersService } from '../solana-helpers/solana-helpers.service';
import { assetType } from 'src/shared/types';
import { SolanaService } from '../solana/solana.service';
import { PrismaService } from 'src/prisma/prisma/prisma.service';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { create, mplCore, ruleSet } from '@metaplex-foundation/mpl-core'
import { createSignerFromKeypair, generateSigner, GenericFile, publicKey, signerIdentity, Umi } from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';  
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import bs58 from 'bs58';

@Injectable()
export class MetaplexService {
    private umi: Umi;

    constructor(
        private readonly configSrv: ConfigService,
        private readonly solHelpersSrv: SolanaHelpersService,
        private readonly solanaSrv: SolanaService,
        private readonly prismaSrv: PrismaService,
    ) {
        const strCliEnv = this.configSrv.get<string>('cli_environment');
        const cliEnv = JSON.parse(strCliEnv) as cliEnv;
        const keypair = this.solHelpersSrv.getChainPortalKeypair(null, cliEnv);

        // Determine the cluster (Devnet or Mainnet)
        const selectedCluster = cliEnv.blockchainNetworks.solana.selected === 'devnet' ? 'devnet' : 'mainnet-beta';
        const clusterUrl = clusterApiUrl(selectedCluster);

        // Create umi with ChainPortal keypair, mplCore and irys uploader
        const umi = createUmi(clusterUrl).use(mplCore()).use(
            irysUploader({address: selectedCluster === 'devnet' ? 'https://devnet.irys.xyz' : 'https://node1.irys.xyz'}));
        const umiSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair));
        this.umi = umi.use(signerIdentity(umiSigner));
    }

    // Calculate metadata upload fee in SOL for arweave, by metadata byte size
    async calcArweaveMetadataUploadFee(metadataByteSize: number): Promise<number> {
        const genericFile: GenericFile = {
            buffer: new Uint8Array(metadataByteSize),
            fileName: 'file.json',
            displayName: 'file.json',
            uniqueName: `${Date.now()}_file.json`,
            contentType: 'application/json',
            extension: 'json',
            tags: [{ name: 'Content-Type', value: 'application/json' }]
        };
        const storageCost = await this.umi.uploader.getUploadPrice([genericFile])
        
        // This condition is unlikely to evaluate as true, but it is not impossible.
        if (storageCost.identifier !== "SOL" || storageCost.decimals !== 9) {
            console.error(`The Arweave NFT metadata upload fee, according to Metaplex umi, is not in the supported SOL cryptocurrency and/or 9 decimals: ${storageCost.identifier}, ${storageCost.decimals}`);
            throw new HttpException(`The Arweave NFT metadata upload fee, according to Metaplex umi, is not in the supported SOL cryptocurrency and/or 9 decimals: ${storageCost.identifier}, ${storageCost.decimals}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return Number(storageCost.basisPoints) / LAMPORTS_PER_SOL;
    }

    // Upload complete NFT metadata (file & metadata) to Arweave
    async uploadNFTMetadataToArweave(metadataObject: NftMetadata, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, uri: string}> {
        const fileUploadResult = await this.uploadMediaToArweave(metadataObject.media, metadataObject.mediaName, metadataObject.mediaContentType, 'NFT', solMintFee, paymentTxSignature);
        if (!fileUploadResult.successful) {return {successful: false, uri: fileUploadResult.fileUri}};
        
        const metadataUploadResult = await this.uploadMetadataObjToArweave({
            name: metadataObject.title,           
            description: metadataObject.description,
            image: fileUploadResult.fileUri, 
            ...(metadataObject.symbol && { symbol: metadataObject.symbol }),
            ...(metadataObject.attributes.length && { attributes: metadataObject.attributes.map(({ type, value }) => ({trait_type: type, value}))}),
            ...(metadataObject.creator && { creator: metadataObject.creator }),
            ...(metadataObject.isLimitedEdition && { isLimitedEdition: metadataObject.isLimitedEdition }),
            ...(metadataObject.totalEditions && { totalEditions: metadataObject.totalEditions }),
            ...(metadataObject.editionNumber && { editionNumber: metadataObject.editionNumber }),
            ...(metadataObject.royalty && { royalty: metadataObject.royalty }),
            ...(metadataObject.tags.length && { tags: metadataObject.tags }),
            ...(metadataObject.license && { license: metadataObject.license }),
            ...(metadataObject.externalLink && { external_url: metadataObject.externalLink }),
            ...(metadataObject.creationTimestampToggle && { creationTimestamp: metadataObject.creationTimestamp }),
        }, solMintFee, 'NFT', paymentTxSignature);
        return {successful: metadataUploadResult.successful, uri: metadataUploadResult.metadataUri};
    }

    // Upload unit 8 array type media file to arweave
    async uploadMediaToArweave(media:  Uint8Array<ArrayBufferLike>, mediaName: string, contentType: string, assetType: assetType, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, fileUri: string}> {
        try {
            // Create a GenericFile object
            const file: GenericFile = {
                buffer: media,
                fileName: mediaName,
                displayName: mediaName,
                uniqueName: `${Date.now()}_${mediaName}`,
                contentType: contentType,
                extension: mediaName.split('.').pop(),
                tags: [{ name: 'Content-Type', value: contentType }],
            };
            const [fileUri] = await this.umi.uploader.upload([file]);
            if (!fileUri) {throw new Error("Uploaded file URI is missing, even though there was no error.")}

            return {successful: true, fileUri: fileUri};
        } catch (error) {
            console.error(`Error uploading media ${mediaName} file to arweave/irys via metaplex umi: `, error);

            let feeWithoutChainPortalFee = solMintFee;
            if (assetType === "NFT") {
                feeWithoutChainPortalFee -= parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE'));
            } else if (assetType === "Token") {
                feeWithoutChainPortalFee -= parseFloat(this.configSrv.get<string>('SOL_TOKEN_MINT_FEE'));
            }

            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, assetType, feeWithoutChainPortalFee);
            if (redirect.isValid) {
                return {successful: false, fileUri: `Unable to upload media file to Arweave so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, fileUri: `Unable to upload media file to Arweave so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Upload NFT metadata object to arweave
    async uploadMetadataObjToArweave(metadata: any, solMintFee: number, assetType: assetType, paymentTxSignature: string): Promise<{successful: boolean, metadataUri: string}> {
        try {
            const uri = await this.umi.uploader.uploadJson(metadata);
            if (!uri) {throw new Error("Uploaded metadata URI is missing, even though there was no error.")}

            return {successful: true, metadataUri: uri};
        } catch (error) {
            console.error(`Error uploading metadata (${JSON.stringify(metadata)}) to arweave/irys via metaplex umi: `, error);

            let feeWithoutChainPortalFee = solMintFee;
            if (assetType === "NFT") {
                feeWithoutChainPortalFee -= parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE'));
            } else if (assetType === "Token") {
                feeWithoutChainPortalFee -= parseFloat(this.configSrv.get<string>('SOL_TOKEN_MINT_FEE'));
            }

            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, assetType, feeWithoutChainPortalFee);
            if (redirect.isValid) {
                return {successful: false, metadataUri: `Unable to upload metadata to Arweave so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, metadataUri: `Unable to upload metadata to Arweave so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Mint NFT on Solana blockchain
    async mintSolNFT(toPubkey: string, lamportPaymentAmount: number, metadataUri: string, name: string, royalty: number, 
        attributes: Array<Attribute>, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, txId: number | string}> {
        try {
            const result = await create(this.umi, {
                asset: generateSigner(this.umi),
                name: name,
                uri: metadataUri,
                owner: publicKey(toPubkey),
                plugins: [{
                    type: 'Royalties',
                    basisPoints: (royalty >= 0 && royalty <= 100) ? Math.round(royalty * 100) : 0,
                    creators: [{address: publicKey(toPubkey), percentage: 100}],
                    ruleSet: ruleSet('None')
                }, {
                    type: 'Attributes',
                    attributeList: attributes ? attributes.map(a => ({ key: a.type, value: a.value })) : []
                }]
            }).sendAndConfirm(this.umi);
            if (result.result.value.err) throw new Error(`Solana NFT minting error, using Metaplex Umi Core: ${result.result.value.err}`);

            // Save the transaction to the db, bc it was successful
            const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                assetType: 'NFT',
                blockchain: 'SOL',
                paymentPubKey: toPubkey,
                paymentAmount: lamportPaymentAmount / LAMPORTS_PER_SOL,
                expenseAmount: solMintFee - parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE')),// TODO - Need to calculate this also and evrwhere where i save data to db
                paymentTxSignature: paymentTxSignature,
                rewardTxs: [{txSignature: bs58.encode(result.signature), type: 'mint'}]
            });

            // Return the mint transaction db history id
            return {successful: true, txId: mintTxHistory.mainTx.id};
        } catch (error) {
            console.error(`Error minting NFT on Solana via metaplex umi core: `, error);
            let feeWithoutChainPortalFee = solMintFee - parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE'));
    
            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, 'NFT', feeWithoutChainPortalFee);
            if (redirect.isValid) {
                return {successful: false, txId: `Unable to mint NFT on Solana via Metaplex so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, txId: `Unable to mint NFT on Solana via Metaplex so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }
}
