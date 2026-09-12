import AWS from 'aws-sdk';
import TelegramBot from 'node-telegram-bot-api';
import { EnvConfig } from '../../env-config';
import { ConfigClient } from './config-client';
import { injectable } from 'inversify';

@injectable()
export class PhotoSender {
  private bucketName = 'telegram-bot-temporal-photo-store';

  constructor(private configClient: ConfigClient) {}

  async getMediaURLs(photoBuffers: Buffer[]): Promise<TelegramBot.InputMediaPhoto[]> {
    const photoUrls: TelegramBot.InputMediaPhoto[] = [];

    for (const [index, buffer] of photoBuffers.entries()) {
      const fileName = `photo_${Date.now()}_${index}.jpg`;
      const url = await this.configClient.uploadToS3(this.bucketName, buffer, fileName);
      if (url) {
        photoUrls.push({ type: 'photo', media: url });
      }
    }

    return photoUrls;
  }
}
