import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { assetType, blockchainFees, blockchainSymbols } from './shared/types';
import { feedback, transaction } from './shared/interfaces';

@Controller()
export class AppController {
  constructor(private readonly appSrv: AppService) {}

  // Return the client environment //ex.: http://localhost:3000/cli-env
  @Get('cli-env')
  getCliEnv(): any {
    return this.appSrv.getCliEnv();
  }

  // Return mint fees //ex.: http://localhost:3000/mint-fees?assetType=NFT&blockchainSymbol=ETH,SOL&metadataByteSize=1234567
  @Get('mint-fees')
  async getMintFees(
    @Query('assetType') assetType: assetType,
    @Query('blockchainSymbol') blockchainSymbols: string, // comma separated 'blockchainSymbols'
    @Query('metadataByteSize') metadataByteSize: number
  ): Promise<blockchainFees> {
    const blockchainSymbolsArray = blockchainSymbols?.split(',').map(symbol => symbol.trim()) as blockchainSymbols[];
    return this.appSrv.getMintFees(assetType, blockchainSymbolsArray, Number(metadataByteSize));
  }

  // Return all transaction history by publick key //ex.: http://localhost:3000/all-tx-history?pubkey=abcd
  @Get('all-tx-history')
  async getAllTxHistory(@Query('pubkey') pubkey: string) {
    return this.appSrv.getAllTxHistory(pubkey);
  }

  // Return transaction details by tx id //ex.: http://localhost:3000/tx-details?txId=1
  @Get('tx-details')
  async getTxDetails(@Query('txId') txId: number): Promise<transaction> {
    return this.appSrv.getTxDetails(Number(txId));
  }

  // Handle feedback submission
  @Post('submit-feedback')
  async submitFeedback(@Body() feedbackData: feedback): Promise<any> {
    return this.appSrv.saveFeedback(feedbackData);
  }
}
