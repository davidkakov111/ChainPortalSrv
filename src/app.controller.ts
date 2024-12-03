import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { assetType, blockchainFees, blockchainSymbols } from './shared/types';
import { cliEnv } from './shared/interfaces';

@Controller()
export class AppController {
  constructor(private readonly appSrv: AppService) {}

  // Return the client environment //ex.: http://localhost:3000/cli-env
  @Get('cli-env')
  getCliEnv(): cliEnv {
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
    return this.appSrv.getMintFees(assetType, blockchainSymbolsArray, metadataByteSize);
  }
}
