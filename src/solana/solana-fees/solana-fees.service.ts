import { Injectable } from '@nestjs/common';
import { assetType, operationType } from 'src/shared/types';
import { MetaplexService } from '../metaplex/metaplex.service';

@Injectable()
export class SolanaFeesService {
    constructor(
        private readonly metaplexSrv: MetaplexService
    ) {}

    // Calculate fees for different operations and assets on the solana blockchain in SOL
    async calculateFees(operationType: operationType, assetType: assetType): Promise<number> {
        if (operationType === "mint") {
            if (assetType === "NFT") {
                const nftMintTxFees = this.metaplexSrv.calculateSolTxFee(5);
                const nftRentExemptionFees = await this.metaplexSrv.nftRentExemptionFeeInSol();
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
}
