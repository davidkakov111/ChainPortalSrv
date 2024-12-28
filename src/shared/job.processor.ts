import { Injectable } from '@nestjs/common';
import { blockchainSymbols } from './types';
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
    try {
      const metadataByteSize = this.helperSrv.calcNftMetadataByteSize(data.NftMetadata);
      if (typeof metadataByteSize === 'string') {
        wsClientEmitError({id: 0, errorMessage: metadataByteSize});
        return;
      }

      if (data.bChainSymbol === 'SOL') {

        // ------------------ Payment transaction validation ------------------
        // Validate the payment transaction
        const mintFees = await this.appSrv.getMintFees("NFT", ["SOL"], metadataByteSize);
        const validation = await this.solanaService.validateSolPaymentTx(data.paymentTxSignature, mintFees.SOL);
        if (!validation.isValid) {
          wsClientEmitError({id: 0, errorMessage: validation.errorMessage});
          return;
        }
        // Notify the client that the payment transaction is valid
        wsClientEmit({id: 0, txId: null});
        // ------------------ Payment transaction validation ------------------


        // TODO - Upload metadata to IPFS and mint the NFT




      } else {
        // TODO - Add other blockchains logic here for NFT minting
        wsClientEmitError({id: 0, errorMessage: 'Unsupported blockchain for NFT minting. Please use a different blockchain'});
      }
    } catch (error) {
      console.error('NFT minting job failed:', error);
      wsClientEmitError({id: -1, errorMessage: 'NFT minting failed. Please try again.'});
      // TODO - Think about it, bc maybe i need to refund the user!!! (Payment validation handle this, so i dont need to do it here)
      throw error;
    }
  }
}