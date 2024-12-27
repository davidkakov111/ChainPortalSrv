import { Test, TestingModule } from '@nestjs/testing';
import { SolanaNftService } from './solana-nft.service';

describe('SolanaNftService', () => {
  let service: SolanaNftService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SolanaNftService],
    }).compile();

    service = module.get<SolanaNftService>(SolanaNftService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
