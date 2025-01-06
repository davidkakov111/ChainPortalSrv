import { Injectable } from '@nestjs/common';
import { blockchainFees, blockchainSymbols } from './types';
import { NftMetadata } from './interfaces';
import { SolanaService } from 'src/solana/solana/solana.service';
import { AppService } from 'src/app.service';
import { HelperService } from './helper/helper/helper.service';
import { PrismaService } from 'src/prisma/prisma/prisma.service';

// Job processor to run codes in background, independent of the client connection
@Injectable()
export class JobProcessor {

  constructor(
    private readonly appSrv: AppService,
    private readonly helperSrv: HelperService,
    private readonly solanaService: SolanaService,
    private readonly prismaService: PrismaService,
  ) {}

  // NFT minting job
  async handleNftMintingJob(
    wsClientEmit: (message: any) => void, 
    wsClientEmitError: (errorMessage: any) => void, 
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ) {
    // Ensure the payment transaction wasn't used before
    const newPayment = await this.wsJobProcessorNewTransactionValidator(wsClientEmitError, data.paymentTxSignature);
    if (!newPayment) return;

    // Try to calculate the NFT mint fees, according to the metadata size
    const mintFees: blockchainFees | undefined = await this.wsJobProcessorNftMintFeesCalculator(wsClientEmitError, data);
    if (!mintFees) return;

    // Spread the logic by blockchains
    if (data.bChainSymbol === 'SOL') {
      try {
        // ------------------ Payment transaction validation ------------------
        const validation = await this.solanaService.validateSolPaymentTx(data.paymentTxSignature, mintFees.SOL);
        if (!validation.isValid) {
          wsClientEmitError({id: 0, errorMessage: validation.errorMessage});
          return;
        }
        wsClientEmit({id: 0, txId: null});
        // ------------------ Payment transaction validation ------------------




        // TODO - Upload metadata to IPFS and mint the NFT...






      } catch (error) {
        console.error('SolanaNFT minting job failed:', error);
        wsClientEmitError({id: -1, errorMessage: 'Solana NFT minting failed. Please try again.'});
        return;
      }
    } else {
      // TODO - Add support for other blockchains later
      wsClientEmitError({id: 0, errorMessage: 'Unsupported blockchain for NFT minting. Please use a different blockchain'});
    }
  }

  //? ------------------------------------ WS Job Processor Helpers ------------------------------------
  // Return ws response if the payment transaction signature is used before
  async wsJobProcessorNewTransactionValidator(wsClientEmitError: (errorMessage: any) => void, paymentTxSignature: string): Promise<boolean> {
    try {
      const isTxSignatureUsed = await this.prismaService.isTransactionSignatureUsed(paymentTxSignature);
      if (isTxSignatureUsed) {
        wsClientEmitError({id: 0, errorMessage: 'Your payment transaction has already been used. Please try again.'});
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to check if payment transaction (', paymentTxSignature, ') signature is used:', error);
      wsClientEmitError({id: 0, errorMessage: 'Failed to check if your payment transaction signature has been used before. Please try again.'});
      return false;
    }
  }

  // Return NFT mint fees and if coudn't calculate it, return ws response
  async wsJobProcessorNftMintFeesCalculator(
    wsClientEmitError: (errorMessage: any) => void,
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ): Promise<blockchainFees | undefined> {
    try {
      const metadataByteSize = this.helperSrv.calcNftMetadataByteSize(data.NftMetadata);
      if (typeof metadataByteSize === 'string') throw new Error(metadataByteSize);
      const mintFees = await this.appSrv.getMintFees("NFT", [data.bChainSymbol], metadataByteSize);
      return mintFees;
    } catch (error) {
      // Redirect the payment if some error occurs
      const redirect = await this.solanaService.redirectSolPayment(data.paymentTxSignature);
      if (redirect.isValid) {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the NFT minting fees so your payment was redirected after deducting the estimated refund fee. Please try again.'});
      } else {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the NFT minting fees. Your payment was redirected but maybe failed: "' + redirect.message + '". Please try again.'});
      }
      console.error('Failed to calculate NFT mint fees:', error);
      return;
    }
  }
  //? ------------------------------------ WS Job Processor Helpers ------------------------------------
}
