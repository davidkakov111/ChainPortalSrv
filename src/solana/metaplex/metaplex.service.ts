import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Connection, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity } from '@metaplex-foundation/js';
import { ConfigService } from '@nestjs/config';
import { cliEnv } from 'src/shared/interfaces';
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

        // Initialize connection to the Solana cluster
        this.connection = new Connection(clusterApiUrl(cliEnv.blockchainNetworks.solana.selected === 'devnet' ? 'devnet' : 'mainnet-beta'));

        // Keypair identity for Metaplex to initialize it
        const keypair = this.solHelpersSrv.getChainPortalKeypair(null, cliEnv);
        this.metaplex = Metaplex.make(this.connection).use(keypairIdentity(keypair));
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
}
