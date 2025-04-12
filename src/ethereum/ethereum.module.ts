import { Module } from '@nestjs/common';
import { EthereumHelpersService } from './ethereum-helpers/ethereum-helpers.service';
import { EthereumService } from './ethereum/ethereum.service';
import { ThirdwebService } from './thirdweb/thirdweb.service';

@Module({
    imports: [],
    controllers: [],
    providers: [EthereumHelpersService, EthereumService, ThirdwebService],
    exports: [EthereumHelpersService, EthereumService, ThirdwebService], 
})
export class EthereumModule {}
