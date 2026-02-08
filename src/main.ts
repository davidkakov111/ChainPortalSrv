import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['https://chainportal.vercel.app'] // 'http://localhost:4200'
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
