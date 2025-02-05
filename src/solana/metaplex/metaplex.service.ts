import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { Attribute, cliEnv, NftMetadata, TokenMetadata } from 'src/shared/interfaces';
import { SolanaHelpersService } from '../solana-helpers/solana-helpers.service';
import { assetType } from 'src/shared/types';
import { SolanaService } from '../solana/solana.service';
import { PrismaService } from 'src/prisma/prisma/prisma.service';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { create, mplCore, ruleSet } from '@metaplex-foundation/mpl-core'
import { createSignerFromKeypair, generateSigner, GenericFile, publicKey, signerIdentity, Umi, percentAmount } from '@metaplex-foundation/umi';
import { TokenStandard, createAndMint, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata'
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

        // Create umi with ChainPortal keypair, mplCore, mplTokenMetadata, and irys uploader
        const umi = createUmi(clusterUrl).use(mplCore()).use(
            irysUploader({address: selectedCluster === 'devnet' ? 'https://devnet.irys.xyz' : 'https://node1.irys.xyz'}));
        const umiSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair));
        umi.use(signerIdentity(umiSigner));
        this.umi = umi.use(mplTokenMetadata());
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

    // Upload complete token metadata (file & metadata) to Arweave
    async uploadTokenMetadataToArweave(metadataObject: TokenMetadata, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, uri: string}> {
        const fileUploadResult = await this.uploadMediaToArweave(metadataObject.media, metadataObject.mediaName, metadataObject.mediaContentType, 'Token', solMintFee, paymentTxSignature);
        if (!fileUploadResult.successful) {return {successful: false, uri: fileUploadResult.fileUri}};
        
        const metadataUploadResult = await this.uploadMetadataObjToArweave({
            name: metadataObject.name, symbol: metadataObject.symbol, external_url: metadataObject.externalLink,
            description: metadataObject.description, image: fileUploadResult.fileUri
        }, solMintFee, 'Token', paymentTxSignature);
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

            let metadataUploadFee = solMintFee;
            if (assetType === "NFT") {
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE'));
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE'));
            } else if (assetType === "Token") {
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_TOKEN_MINT_FEE'));
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('SOL_TOKEN_MINT_FEE'));
            }

            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, assetType, metadataUploadFee, [{txSignature: `Media file upload to Arweave failed via Metaplex UMI.`, type: 'metadata upload'}]);
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

            let metadataUploadFee = solMintFee;
            if (assetType === "NFT") {
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE'));
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE'));
            } else if (assetType === "Token") {
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_TOKEN_MINT_FEE'));
                metadataUploadFee -= parseFloat(this.configSrv.get<string>('SOL_TOKEN_MINT_FEE'));
            }

            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, assetType, metadataUploadFee, [
                {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'}, 
                {txSignature: "Metadata object upload to Arweave failed via Metaplex UMI.", type: 'metadata upload'}
            ]);
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

            try {
                // Calcualte the exact expense amount i payed for on chain minting and add the estimated metadata upload fee
                const ourSolBallanceChange = await this.solanaSrv.getOurSolBallanceChange(bs58.encode(result.signature));
                let expenses = 0;
                if (ourSolBallanceChange && ourSolBallanceChange < 0) {
                    const metadataUploadFees = solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE')) - parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE')); 
                    expenses = metadataUploadFees + (ourSolBallanceChange * -1);
                } else {
                    expenses = solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE'));
                }

                // Save the transaction to the db, bc it was successful
                const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                    assetType: 'NFT',
                    blockchain: 'SOL',
                    paymentPubKey: toPubkey,
                    paymentAmount: lamportPaymentAmount / LAMPORTS_PER_SOL,
                    expenseAmount: expenses,
                    paymentTxSignature: paymentTxSignature,
                    rewardTxs: [
                        {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'}, 
                        {txSignature: "Metadata object upload to Arweave via Metaplex UMI.", type: 'metadata upload'},
                        {txSignature: bs58.encode(result.signature), type: 'mint'}
                    ]
                });
                // Return the mint transaction db history id
                return {successful: true, txId: mintTxHistory.mainTx.id};
            } catch (error) {
                // Save the transaction to the db, bc it was successful, however coudnt calculate the exact expense amount, so use estimate
                const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                    assetType: 'NFT',
                    blockchain: 'SOL',
                    paymentPubKey: toPubkey,
                    paymentAmount: lamportPaymentAmount / LAMPORTS_PER_SOL,
                    expenseAmount: solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE')),
                    paymentTxSignature: paymentTxSignature,
                    rewardTxs: [
                        {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'}, 
                        {txSignature: "Metadata object upload to Arweave via Metaplex UMI.", type: 'metadata upload'},
                        {txSignature: bs58.encode(result.signature), type: 'mint'}
                    ]
                });
                // Return the mint transaction db history id
                return {successful: true, txId: mintTxHistory.mainTx.id};
            }
        } catch (error) {
            console.error(`Error minting NFT on Solana via metaplex umi core: `, error);
            let feeWithoutChainPortalFee = solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE'));
    
            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, 'NFT', feeWithoutChainPortalFee, [
                {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'}, 
                {txSignature: "Metadata object upload to Arweave via Metaplex UMI.", type: 'metadata upload'},
                {txSignature: "NFT minting failed with Metaplex UMI on Solana blockchain.", type: 'mint'}
            ]);
            if (redirect.isValid) {
                return {successful: false, txId: `Unable to mint NFT on Solana via Metaplex so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, txId: `Unable to mint NFT on Solana via Metaplex so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }

    // Mint tokens on Solana blockchain
    async mintSolTokens(toPubkey: string, lamportPaymentAmount: number, metadataUri: string, tokenMetadata: TokenMetadata, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, txId: number | string}> {
        try {
            const mint = generateSigner(this.umi);
            const result = await createAndMint(this.umi, {
                mint,
                authority: this.umi.identity,
                name: tokenMetadata.name,
                symbol: tokenMetadata.symbol,
                uri: metadataUri,
                sellerFeeBasisPoints: percentAmount(0),
                decimals: tokenMetadata.decimals,
                amount: tokenMetadata.supply,
                tokenOwner: publicKey(toPubkey),
                tokenStandard: TokenStandard.Fungible,
            }).sendAndConfirm(this.umi)
            if (result.result.value.err) throw new Error(`Solana token minting error, using Metaplex Umi Core: ${result.result.value.err}`);

            try {
                // Calcualte the exact expense amount i payed for on chain minting and add the estimated metadata upload fee
                const ourSolBallanceChange = await this.solanaSrv.getOurSolBallanceChange(bs58.encode(result.signature));
                let expenses = 0;
                if (ourSolBallanceChange && ourSolBallanceChange < 0) {
                    const metadataUploadFees = solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE')) - parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE')); 
                    expenses = metadataUploadFees + (ourSolBallanceChange * -1);
                } else {
                    expenses = solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE'));
                }

                // Save the transaction to the db, bc it was successful
                const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                    assetType: 'Token',
                    blockchain: 'SOL',
                    paymentPubKey: toPubkey,
                    paymentAmount: lamportPaymentAmount / LAMPORTS_PER_SOL,
                    expenseAmount: expenses,
                    paymentTxSignature: paymentTxSignature,
                    rewardTxs: [
                        {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'}, 
                        {txSignature: "Metadata object upload to Arweave via Metaplex UMI.", type: 'metadata upload'},
                        {txSignature: bs58.encode(result.signature), type: 'mint'}
                    ]
                });
                // Return the mint transaction db history id
                return {successful: true, txId: mintTxHistory.mainTx.id};
            } catch (error) {
                // Save the transaction to the db, bc it was successful, however coudnt calculate the exact expense amount, so use estimate
                const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                    assetType: 'Token',
                    blockchain: 'SOL',
                    paymentPubKey: toPubkey,
                    paymentAmount: lamportPaymentAmount / LAMPORTS_PER_SOL,
                    expenseAmount: solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_NFT_MINT_FEE')),
                    paymentTxSignature: paymentTxSignature,
                    rewardTxs: [
                        {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'}, 
                        {txSignature: "Metadata object upload to Arweave via Metaplex UMI.", type: 'metadata upload'},
                        {txSignature: bs58.encode(result.signature), type: 'mint'}
                    ]
                });
                // Return the mint transaction db history id
                return {successful: true, txId: mintTxHistory.mainTx.id};
            }
        } catch (error) {
            console.error(`Error minting tokens on Solana via metaplex umi core: `, error);
            let feeWithoutChainPortalFee = solMintFee - parseFloat(this.configSrv.get<string>('CHAIN_PORTAL_SOL_TOKEN_MINT_FEE'));
    
            // Redirect the payment after deducting potential fees
            const redirect = await this.solanaSrv.redirectSolPayment(paymentTxSignature, 'Token', feeWithoutChainPortalFee, [
                {txSignature: `Media file upload to Arweave via Metaplex UMI.`, type: 'metadata upload'},
                {txSignature: "Metadata object upload to Arweave via Metaplex UMI.", type: 'metadata upload'},
                {txSignature: "Token minting failed with Metaplex UMI on Solana blockchain.", type: 'mint'}
            ]);
            if (redirect.isValid) {
                return {successful: false, txId: `Unable to mint tokens on Solana via Metaplex so your payment was redirected after deducting the estimated fee(s). Please try again.`};
            } else {
                return {successful: false, txId: `Unable to mint tokens on Solana via Metaplex so your payment was redirected but maybe failed. Please try again.`};
            }
        }
    }
}
