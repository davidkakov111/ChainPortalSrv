import { Test, TestingModule } from '@nestjs/testing';
import { WebshocketGateway } from './webshocket.gateway';

describe('WebshocketGateway', () => {
  let gateway: WebshocketGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebshocketGateway],
    }).compile();

    gateway = module.get<WebshocketGateway>(WebshocketGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
