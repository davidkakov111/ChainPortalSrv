import { Test, TestingModule } from '@nestjs/testing';
import { MetaplexService } from './metaplex.service';

describe('MetaplexService', () => {
  let service: MetaplexService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetaplexService],
    }).compile();

    service = module.get<MetaplexService>(MetaplexService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
