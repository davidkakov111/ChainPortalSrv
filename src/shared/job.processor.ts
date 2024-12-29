import { Injectable } from '@nestjs/common';
import { blockchainFees, blockchainSymbols } from './types';
import { NftMetadata } from './interfaces';
import { SolanaService } from 'src/solana/solana/solana.service';
import { AppService } from 'src/app.service';
import { HelperService } from './helper/helper/helper.service';

// Job processor to run codes in background, independent of the client connection
@Injectable()
export class JobProcessor {

  constructor(
    private readonly appSrv: AppService,
    private readonly helperSrv: HelperService,
    private readonly solanaService: SolanaService,
  ) {}

  // NFT minting job
  async handleNftMintingJob(
    wsClientEmit: (message: any) => void, 
    wsClientEmitError: (errorMessage: any) => void, 
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ) {
    // Try to calculate the NFT mint fees, according to the metadata size
    let mintFees: blockchainFees;
    try {
      const metadataByteSize = this.helperSrv.calcNftMetadataByteSize(data.NftMetadata);
      if (typeof metadataByteSize === 'string') throw new Error(metadataByteSize);
      mintFees = await this.appSrv.getMintFees("NFT", [data.bChainSymbol], metadataByteSize);
    } catch (error) {
      // Redirect the payment if some error occurs
      const redirect = await this.solanaService.redirectSolPayment(data.paymentTxSignature);
      if (!redirect.isValid) {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the NFT minting fees so your payment was redirected after deducting the estimated refund fee. Please try again.'});
      } else {
        wsClientEmitError({id: 0, errorMessage: 'Unable to calculate the NFT minting fees. Your payment was redirected but failed: "' + redirect.message + '". Please try again.'});
      }
      console.error('Failed to calculate NFT mint fees:', error);
      return;
    }

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
}