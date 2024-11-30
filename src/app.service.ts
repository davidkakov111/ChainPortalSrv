import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface cliEnv {
  reownProjectId: string,
  blockchainNetworks: {
    solana: {
      selected: 'devnet'|'mainnet',
      pubKey: string,
    }, 
  },
}

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  // Return client environment variables
  getCliEnv(): cliEnv {
    const strCliEnv = this.configService.get<string>('cli_environment');
    return JSON.parse(strCliEnv) as cliEnv;
  }
}
