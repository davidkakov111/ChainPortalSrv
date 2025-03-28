import { Test, TestingModule } from '@nestjs/testing';
import { EthereumHelpersService } from './ethereum-helpers.service';

describe('EthereumHelpersService', () => {
  let service: EthereumHelpersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EthereumHelpersService],
    }).compile();

    service = module.get<EthereumHelpersService>(EthereumHelpersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
