import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AppConfigModule, MarketDataModule],
  controllers: [HealthController],
})
export class HealthModule {}
