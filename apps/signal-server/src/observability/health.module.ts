import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { CalendarModule } from '../calendar/calendar.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AppConfigModule, MarketDataModule, CalendarModule],
  controllers: [HealthController],
})
export class HealthModule {}
