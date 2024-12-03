import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cliEnv } from './shared/interfaces';
import { assetType, blockchainFees, blockchainSymbols } from './shared/types';
import { PrismaService } from './prisma/prisma/prisma.service';
import { SolanaFeesService } from './solana/solana-fees/solana-fees.service';
import { MetaplexService } from './solana/metaplex/metaplex.service';
import { HelperService } from './shared/helper/helper/helper.service';

@Injectable()
export class AppService {
  constructor(
    private readonly configSrv: ConfigService,
    private readonly prismaSrv: PrismaService,
    private readonly solanaFeesSrv: SolanaFeesService,
    private readonly metaplexSrv: MetaplexService,
    private readonly helperSrv: HelperService
  ) {}

  // Return client environment variables
  getCliEnv(): cliEnv {
    const strCliEnv = this.configSrv.get<string>('cli_environment');
    return JSON.parse(strCliEnv) as cliEnv;
  }

  // Return  mint fees based on blockchain and asset type
  async getMintFees(assetType: assetType, blockchainSymbols: blockchainSymbols[], metadataByteSize: number = 0): Promise<blockchainFees> {
    if (!["NFT", "Token"].includes(assetType) || !blockchainSymbols?.length) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    // Remove possible duplicated bchain symbols
    blockchainSymbols = Array.from(new Set(blockchainSymbols));

    const result: blockchainFees = {};

    // Asign to the result the existing 'fresh' fees from db
    const dbBchainFees = await this.prismaSrv.getMintingFees(assetType, blockchainSymbols);
    for (let i of dbBchainFees) {
      result[i.bchainSymbol] = Number(i.fee);
      blockchainSymbols = blockchainSymbols.filter(symbol => symbol !== i.bchainSymbol);
    }
    
    // Calculate the fees for the rest blockcahins
    for (let i of blockchainSymbols) {
      if (i === "SOL") {
        result.SOL = await this.solanaFeesSrv.calculateFees("mint", assetType);
        await this.prismaSrv.upsertMintingFee(assetType, 'SOL', result.SOL);
      } // TODO - Need to add options for another suported bchains later
    }

    // Calculate & assign the metadata upload costs
    if (result.SOL) {
      const metadataUploadFee = await this.metaplexSrv.calcArweaveMetadataUploadFee(metadataByteSize);
      result.SOL += metadataUploadFee;
    } // TODO - Need to add options for another suported bchains later

    // Round up the fees to 5 decimals
    for (const key in result) {
      if (result.hasOwnProperty(key) && result[key] !== undefined) {
        result[key as keyof blockchainFees] = this.helperSrv.roundUpToFiveDecimals(result[key]);
      }
    }

    return result;
  }
}
