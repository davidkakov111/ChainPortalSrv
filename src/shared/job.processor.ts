import { Injectable } from '@nestjs/common';

// Job processor to run codes in background, independent of the client connection
@Injectable()
export class JobProcessor {

  // NFT minting job
  async handleNftMintingJob(wsClientEmit: (message: string) => void, data: any) {
    try {
      // TODO - Process steps also asynchronously with await in sequence (this is just a test):
      // for (let i = 0; i < 3; i++) {
      //   await new Promise(resolve => setTimeout(resolve, 2000));
      //   wsClientEmit(`${i} step completed`);
      // }
      
      return { success: true };
    } catch (error) {
      console.error('NFT minting job failed:', error);
      throw error;
    }
  }
}