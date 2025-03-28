import { Module } from '@nestjs/common';
import { EthereumHelpersService } from './ethereum-helpers/ethereum-helpers.service';

@Module({
    imports: [],
    controllers: [],
    providers: [EthereumHelpersService],
    exports: [EthereumHelpersService], 
})
export class EthereumModule {}
