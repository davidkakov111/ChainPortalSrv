import { Injectable } from '@nestjs/common';
import { blockchainSymbols } from './types';
import { NftMetadata } from './interfaces';

// Job processor to run codes in background, independent of the client connection
@Injectable()
export class JobProcessor {

  // NFT minting job
  async handleNftMintingJob(
    wsClientEmit: (message: any) => void, 
    wsClientEmitError: (errorMessage: any) => void, 
    data: {bChainSymbol: blockchainSymbols, paymentTxSignature: string, NftMetadata: NftMetadata}
  ) {
    try {
      if (data.bChainSymbol === 'SOL') {



        // TODO - Process steps also asynchronously with await in sequence (this is just a test):
        // for (let i = 0; i < 3; i++) {
        //   await new Promise(resolve => setTimeout(resolve, 2000));
        //   wsClientEmit(`${i} step completed`);
        // }




      } else {
        // TODO - Add other blockchains logic here for NFT minting
        wsClientEmitError({id: 0, errorMessage: 'Unsupported blockchain for NFT minting'});
      }

      return { finalized: true };
    } catch (error) {
      console.error('NFT minting job failed:', error);
      wsClientEmitError({id: -1, errorMessage: 'NFT minting failed. Please try again.'});
      // TODO - Think about it, bc maybe i need to refund the user
      throw error;
    }
  }
}