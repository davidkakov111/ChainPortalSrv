import { Module } from '@nestjs/common';
import { EthereumHelpersService } from './ethereum-helpers/ethereum-helpers.service';
import { EthereumService } from './ethereum/ethereum/ethereum.service';

@Module({
    imports: [],
    controllers: [],
    providers: [EthereumHelpersService, EthereumService],
    exports: [EthereumHelpersService, EthereumService], 
})
export class EthereumModule {}
