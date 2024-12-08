import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cliEnv, transaction } from './shared/interfaces';
import { assetType, blockchainFees, blockchainSymbols, operationType } from './shared/types';
import { PrismaService } from './prisma/prisma/prisma.service';
import { SolanaFeesService } from './solana/solana-fees/solana-fees.service';
import { MetaplexService } from './solana/metaplex/metaplex.service';
import { HelperService } from './shared/helper/helper/helper.service';
import { Decimal } from '@prisma/client/runtime/library';

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
    
    // Calculate & save the fees for the rest blockchains
    for (let i of blockchainSymbols) {
      if (i === "SOL") {
        // Basic fees without metadata upload fees
        result.SOL = await this.solanaFeesSrv.calculateFees("mint", assetType);

        // ChainPortal fees
        if (assetType === "NFT") {
          result.SOL += parseFloat(this.configSrv.get<string>('SOL_NFT_MINT_FEE'));
        } else if (assetType === "Token") {
          result.SOL += parseFloat(this.configSrv.get<string>('SOL_TOKEN_MINT_FEE'));
        }
        
        await this.prismaSrv.upsertMintingFee(assetType, 'SOL', result.SOL);        
      } // TODO - Need to add options for another suported bchains later
    }

    // Calculate & assign the metadata upload costs
    if (result.SOL) {
      const metadataUploadFee = await this.metaplexSrv.calcArweaveMetadataUploadFee(metadataByteSize);
      result.SOL += metadataUploadFee;
    } // TODO - Need to add options for another suported bchains later

    // Round up the fees to 4 decimals
    for (const key in result) {
      if (result.hasOwnProperty(key) && result[key] !== undefined) {
        result[key as keyof blockchainFees] = this.helperSrv.roundUpToDecimals(result[key], 4);
      }
    }

    return result;
  }

  // Return all transaction history by pubkey
  async getAllTxHistory(pubkey: string) {
    if (!pubkey) throw new HttpException('Missing pubkey', HttpStatus.BAD_REQUEST);
    return await this.prismaSrv.getAllTxHistory(pubkey);
  }

  // Return transaction details by tx id
  async getTxDetails(txId: number): Promise<transaction> {
    if (!txId) throw new HttpException('Missing transaction id', HttpStatus.BAD_REQUEST);
    
    const txDetails = await this.prismaSrv.getTxDetails(txId);
    if (!txDetails) throw new HttpException('Transaction not found', HttpStatus.NOT_FOUND);

    // Modify the result to match the `transaction` interface
    return {
      id: txDetails.id,
      operationType: txDetails.operationType as operationType,
      assetType: txDetails.assetType as assetType,
      blockchain: txDetails.blockchain as blockchainSymbols,
      paymentPubKey: txDetails.paymentPubKey,
      paymentAmount: new Decimal(txDetails.paymentAmount).toNumber(), // Convert Decimal to number
      expenseAmount: new Decimal(txDetails.expenseAmount).toNumber(), // Convert Decimal to number
      date: txDetails.date,
      MintTxHistories: txDetails.MintTxHistories.map((mintTx) => ({
        id: mintTx.id,
        mainTxHistoryId: mintTx.mainTxHistoryId,
        paymentTxSignature: mintTx.paymentTxSignature,
        rewardTxs: Array.isArray(mintTx.rewardTxs) // Safely parse the JSON if it’s an array
          ? mintTx.rewardTxs.map((reward: any) => ({
              txSignature: reward.txSignature,
              type: reward.type,
            }))
          : [],
      })),
    };
  }
}
