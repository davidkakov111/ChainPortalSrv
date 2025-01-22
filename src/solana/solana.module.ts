import { Module } from '@nestjs/common';
import { SolanaFeesService } from './solana-fees/solana-fees.service';
import { MetaplexService } from './metaplex/metaplex.service';
import { SolanaHelpersService } from './solana-helpers/solana-helpers.service';
import { SolanaNftService } from './solana-nft/solana-nft.service';
import { SolanaService } from './solana/solana.service';
import { HelperModule } from 'src/shared/helper/helper.module';

@Module({
    imports: [HelperModule],
    controllers: [],
    providers: [SolanaFeesService, MetaplexService, SolanaHelpersService, SolanaNftService, SolanaService],
    exports: [SolanaFeesService, MetaplexService, SolanaNftService, SolanaService, SolanaHelpersService], 
})
export class SolanaModule {}
