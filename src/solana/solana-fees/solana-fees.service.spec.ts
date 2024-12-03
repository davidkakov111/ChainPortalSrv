import { Test, TestingModule } from '@nestjs/testing';
import { SolanaFeesService } from './solana-fees.service';

describe('SolanaFeesService', () => {
  let service: SolanaFeesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SolanaFeesService],
    }).compile();

    service = module.get<SolanaFeesService>(SolanaFeesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
