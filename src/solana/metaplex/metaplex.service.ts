import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Connection, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity, irysStorage, toMetaplexFile } from '@metaplex-foundation/js';
import { ConfigService } from '@nestjs/config';
import { cliEnv, NftMetadata } from 'src/shared/interfaces';
import { BN } from 'bn.js';
import { SolanaHelpersService } from '../solana-helpers/solana-helpers.service';

@Injectable()
export class MetaplexService {
    private connection: Connection;
    private metaplex: Metaplex;

    constructor(
        private readonly configSrv: ConfigService,
        private readonly solHelpersSrv: SolanaHelpersService
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
    async uploadNFTMetadataToArweave(metadataObject: NftMetadata): Promise<{successful: boolean, uri: string}> {
        const fileUploadResult = await this.uploadMediaToArweave(metadataObject.media, metadataObject.mediaName);
        if (!fileUploadResult.successful) {return {successful: false, uri: fileUploadResult.fileUri}};
        
        const metadataUploadResult = await this.uploadMetadataObjToArweave({
            name: metadataObject.title,           
            description: metadataObject.description,
            image: fileUploadResult.fileUri, 
            ...(metadataObject.attributes.length && { attributes: JSON.parse(JSON.stringify(metadataObject.attributes)) }),
            ...(metadataObject.creator && { creator: metadataObject.creator }),
            ...(metadataObject.isLimitedEdition && { isLimitedEdition: metadataObject.isLimitedEdition }),
            ...(metadataObject.totalEditions && { totalEditions: metadataObject.totalEditions }),
            ...(metadataObject.editionNumber && { editionNumber: metadataObject.editionNumber }),
            ...(metadataObject.royalty && { royalty: metadataObject.royalty }),
            ...(metadataObject.tags.length && { tags: metadataObject.tags }),
            ...(metadataObject.license && { license: metadataObject.license }),
            ...(metadataObject.externalLink && { externalLink: metadataObject.externalLink }),
            ...(metadataObject.creationTimestampToggle && { creationTimestamp: metadataObject.creationTimestamp }),
        });
        return {successful: metadataUploadResult.successful, uri: metadataUploadResult.metadataUri};
    }

    // Upload unit 8 array type media file to arweave
    async uploadMediaToArweave(media:  Uint8Array<ArrayBufferLike>, mediaName: string): Promise<{successful: boolean, fileUri: string}> {
        try {
            // Convert the file to Metaplex format & upload the file to arweave
            const metaplexFile = toMetaplexFile(media, mediaName);
            const fileUri = await this.metaplex.storage().upload(metaplexFile);
            return {successful: true, fileUri: fileUri};
        } catch (error) {
            console.error(`Error uploading media ${mediaName} file to arweave via metaplex: `, error);
            return {successful: false, fileUri: `Error uploading media ${mediaName} file to arweave via metaplex`};
        }
    }

    // Upload NFT metadata object to arweave
    async uploadMetadataObjToArweave(metadata: any): Promise<{successful: boolean, metadataUri: string}> {
        try {
            const { uri } = await this.metaplex.nfts().uploadMetadata(metadata);
            return {successful: true, metadataUri: uri};
        } catch (error) {
            console.error(`Error uploading metadata (${JSON.stringify(metadata)}) to arweave via metaplex: `, error);
            return {successful: false, metadataUri: `Error uploading metadata (${JSON.stringify(metadata)}) to arweave via metaplex`};
        }
    }
}
