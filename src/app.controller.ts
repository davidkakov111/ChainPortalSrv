import { Controller, Get } from '@nestjs/common';
import { AppService, cliEnv } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Return the client environment
  @Get('cli-env')
  getCliEnv(): cliEnv {
    return this.appService.getCliEnv();
  }
}
