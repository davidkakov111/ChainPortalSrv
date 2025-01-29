import { Module } from '@nestjs/common';
import { MetaplexService } from './metaplex/metaplex.service';
import { SolanaHelpersService } from './solana-helpers/solana-helpers.service';
import { SolanaService } from './solana/solana.service';
import { HelperModule } from 'src/shared/helper/helper.module';

@Module({
    imports: [HelperModule],
    controllers: [],
    providers: [MetaplexService, SolanaHelpersService, SolanaService],
    exports: [MetaplexService, SolanaService, SolanaHelpersService], 
})
export class SolanaModule {}
