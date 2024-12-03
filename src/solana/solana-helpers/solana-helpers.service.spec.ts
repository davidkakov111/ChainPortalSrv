import { Test, TestingModule } from '@nestjs/testing';
import { SolanaHelpersService } from './solana-helpers.service';

describe('SolanaHelpersService', () => {
  let service: SolanaHelpersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SolanaHelpersService],
    }).compile();

    service = module.get<SolanaHelpersService>(SolanaHelpersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
