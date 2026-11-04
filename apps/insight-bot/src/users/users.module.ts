import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { UsersService } from './users.service';

/**
 * IB-035 — ONE `UsersService` for the bot (`DeliveryModule`) and the site (`WebModule`). It used to
 * be a provider of `DeliveryModule`, which imports `WebModule`, so the site could not reach it
 * without a cycle. The members page must use the same service as `/users`, `/invite`, `/lang` and
 * `/calendar`, not a second copy.
 */
@Module({
  imports: [AppConfigModule, DbModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
