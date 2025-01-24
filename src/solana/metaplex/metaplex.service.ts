import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Connection, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity, irysStorage, toMetaplexFile, toBigNumber } from '@metaplex-foundation/js';
import { ConfigService } from '@nestjs/config';
import { cliEnv, NftMetadata } from 'src/shared/interfaces';
import { BN } from 'bn.js';
import { SolanaHelpersService } from '../solana-helpers/solana-helpers.service';
import { assetType } from 'src/shared/types';
import { SolanaService } from '../solana/solana.service';
import { PrismaService } from 'src/prisma/prisma/prisma.service';

@Injectable()
export class MetaplexService {
    private connection: Connection;
    private metaplex: Metaplex;

    constructor(
        private readonly configSrv: ConfigService,
        private readonly solHelpersSrv: SolanaHelpersService,
        private readonly solanaSrv: SolanaService,
        private readonly prismaSrv: PrismaService,
    ) {
        const strCliEnv = this.configSrv.get<string>('cli_environment');
        const cliEnv = JSON.parse(strCliEnv) as cliEnv;

        // Determine the cluster (Devnet or Mainnet)
        const selectedCluster = cliEnv.blockchainNetworks.solana.selected === 'devnet' ? 'devnet' : 'mainnet-beta';

        const clusterUrl = clusterApiUrl(selectedCluster);

        // Initialize connection to the Solana cluster
        this.connection = new Connection(clusterUrl);

        // Keypair identity for Metaplex to initialize it
        const keypair = this.solHelpersSrv.getChainPortalKeypair(null, cliEnv);
        this.metaplex = Metaplex.make(this.connection).use(keypairIdentity(keypair)).use(
            irysStorage({
              address: selectedCluster === 'devnet' ? 'https://devnet.irys.xyz' : 'https://mainnet.irys.xyz',
              providerUrl: clusterUrl,
              timeout: 60000,
            }),
        );
    }

    // Calculate metadata upload fee in SOL for arweave, by metadata byte size
    async calcArweaveMetadataUploadFee(metadataByteSize: number): Promise<number> {
        const storageCost = await this.metaplex.storage().getUploadPriceForBytes(metadataByteSize);

        // This condition is unlikely to evaluate as true, but it is not impossible.
        if (storageCost.currency.symbol !== "SOL") {
            console.error(`The Arweave NFT metadata upload fee, according to Metaplex, is not in the supported SOL cryptocurrency: ${storageCost.currency.symbol}`);
            throw new HttpException(`The Arweave NFT metadata upload fee, according to Metaplex, is not in the supported SOL cryptocurrency: ${storageCost.currency.symbol}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        // Extract the basis points (cost in lamports) and currency decimals
        const basisPoints = new BN(storageCost.basisPoints);
        const decimals = storageCost.currency.decimals;
        // Convert to SOL
        const costInSol = basisPoints.toNumber() / Math.pow(10, decimals);
        return costInSol;
    }

    // Calculate solana rent-exempt fees to keep accounts alive on the blockchain. (Mint, Metadata and Token Accounts)
    async nftRentExemptionFeeInSol(): Promise<number> {
        const totalRentExemptionLamports = await this.connection.getMinimumBalanceForRentExemption(82 + 200 + 165);
        return totalRentExemptionLamports / LAMPORTS_PER_SOL;
    }

    // Calculate solana transaction fees by nr. of transactions
    calculateSolTxFee(nrOfTransactions: number) {
        const transactionFeePerTx = 0.000005; // SOL
        return transactionFeePerTx * nrOfTransactions;
    }

    // Upload complete NFT metadata (file & metadata) to Arweave
    async uploadNFTMetadataToArweave(metadataObject: NftMetadata, assetType: assetType, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, uri: string}> {
        const fileUploadResult = await this.uploadMediaToArweave(metadataObject.media, metadataObject.mediaName, assetType, solMintFee, paymentTxSignature);
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
        }, solMintFee, assetType, paymentTxSignature);
        return {successful: metadataUploadResult.successful, uri: metadataUploadResult.metadataUri};
    }

    // Upload unit 8 array type media file to arweave
    async uploadMediaToArweave(media:  Uint8Array<ArrayBufferLike>, mediaName: string, assetType: assetType, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, fileUri: string}> {
        try {
            // Convert the file to Metaplex format & upload the file to arweave
            const metaplexFile = toMetaplexFile(media, mediaName);
            const fileUri = await this.metaplex.storage().upload(metaplexFile);
            if (!fileUri) {throw new Error("Uploaded file URI is missing, even though there was no error.")}
            return {successful: true, fileUri: fileUri};
        } catch (error) {
            console.error(`Error uploading media ${mediaName} file to arweave via metaplex: `, error);

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
            const { uri } = await this.metaplex.nfts().uploadMetadata(metadata);
            if (!uri) {throw new Error("Uploaded metadata URI is missing, even though there was no error.")}
            return {successful: true, metadataUri: uri};
        } catch (error) {
            console.error(`Error uploading metadata (${JSON.stringify(metadata)}) to arweave via metaplex: `, error);

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
    async mintSolNFT(toPubkey: string, solPaymentAmount: number, metadataUri: string, metadata: {name: string, symbol: string, royalty: number}, solMintFee: number, paymentTxSignature: string): Promise<{successful: boolean, txId: number | string}> {
        try {
            // Create the NFT
            const { nft, response } = await this.metaplex.nfts().create({
                tokenOwner: new PublicKey(toPubkey),
                uri: metadataUri,
                name: metadata.name,
                sellerFeeBasisPoints: (metadata.royalty >= 0 && metadata.royalty <= 100) ? Math.round(metadata.royalty * 100) : 0,
                symbol: metadata.symbol,
                creators: [{address: new PublicKey(toPubkey), share: 100}],
                isMutable: false,
                maxSupply: toBigNumber(0),
            })
            if (!nft.address.toBase58() || !response.signature) throw new Error('Minted Solana NFT address or its mint transaction signature is missing, even though there was no error.');

            // Save the transaction to the db, bc it was successful
            const mintTxHistory = await this.prismaSrv.saveMintTxHistory({
                assetType: 'NFT',
                blockchain: 'SOL',
                paymentPubKey: toPubkey,
                paymentAmount: solPaymentAmount,
                expenseAmount: solMintFee - parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE')),// TODO - Need to calculate this also and evrwhere where i save data to db
                paymentTxSignature: paymentTxSignature,
                rewardTxs: [{txSignature: response.signature, type: 'mint'}]
            });

            // Return the mint transaction db history id
            return {successful: true, txId: mintTxHistory.mainTx.id};
        } catch (error) {
            console.error(`Error minting NFT on Solana via metaplex: `, error);
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
