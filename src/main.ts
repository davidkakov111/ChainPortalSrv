import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:4200', 'https://chainportal.vercel.app'], // Allow requests from local Angular app
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
