import { Module } from '@nestjs/common';
import { SolanaFeesService } from './solana-fees/solana-fees.service';
import { MetaplexService } from './metaplex/metaplex.service';
import { SolanaHelpersService } from './solana-helpers/solana-helpers.service';

@Module({
    imports: [],
    controllers: [],
    providers: [SolanaFeesService, MetaplexService, SolanaHelpersService],
    exports: [SolanaFeesService, MetaplexService], 
})
export class SolanaModule {}
