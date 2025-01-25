import { Injectable } from '@nestjs/common';
import { assetType, operationType } from 'src/shared/types';
import { clusterApiUrl, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { cliEnv } from 'src/shared/interfaces';

@Injectable()
export class SolanaFeesService {
    private connection: Connection;

    constructor(private readonly configSrv: ConfigService) {
        const strCliEnv = this.configSrv.get<string>('cli_environment');
        const cliEnv = JSON.parse(strCliEnv) as cliEnv;

        // Initialize connection to the Solana cluster (devnet or mainnet)
        const clusterUrl = clusterApiUrl(cliEnv.blockchainNetworks.solana.selected === 'devnet' ? 'devnet' : 'mainnet-beta');
        this.connection = new Connection(clusterUrl);
    }

    // Calculate fees for different operations and assets on the solana blockchain in SOL
    async calculateFees(operationType: operationType, assetType: assetType): Promise<number> {
        if (operationType === "mint") {
            if (assetType === "NFT") {
                const nftMintTxFees = this.calculateSolTxFee(5);
                const nftRentExemptionFees = await this.nftRentExemptionFeeInSol();
                return nftMintTxFees + nftRentExemptionFees;
            } else if (assetType === "Token") {
                return 0; // TODO - Need to calculate this, once implemented
            }
        } else if (operationType === "bridge") {
            if (assetType === "NFT") {
                return 0; // TODO - Need to calculate this, once implemented
            } else if (assetType === "Token") {
                return 0; // TODO - Need to calculate this, once implemented
            }
        }
    }

    // Calculate solana rent-exempt fees to keep accounts alive on the blockchain. (Mint, Metadata and Token Accounts)
    async nftRentExemptionFeeInSol(): Promise<number> {
        // TODO - May i need to use umi fro this, umi.rpc?.rent...
        const totalRentExemptionLamports = await this.connection.getMinimumBalanceForRentExemption(82 + 200 + 165);
        return totalRentExemptionLamports / LAMPORTS_PER_SOL;
    }

    // Calculate solana transaction fees by nr. of transactions
    calculateSolTxFee(nrOfTransactions: number) {
        const transactionFeePerTx = 0.000005; // SOL
        return transactionFeePerTx * nrOfTransactions;
    }
}
