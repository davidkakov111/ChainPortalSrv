import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SolanaModule } from './solana/solana.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HelperModule } from './shared/helper/helper.module';
import { WebshocketGateway } from './webshocket/webshocket.gateway';
import { JobProcessor } from './shared/job.processor';
import { EthereumModule } from './ethereum/ethereum.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes the ConfigModule available globally to use .env
    }),
    SolanaModule,
    PrismaModule,
    HelperModule,
    EthereumModule,
  ],
  controllers: [AppController],
  providers: [AppService, WebshocketGateway, JobProcessor],
})
export class AppModule {}
