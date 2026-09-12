import { Logger } from 'winston';
import { EnvConfig } from '../../env-config';
import AWS from 'aws-sdk';
import { injectable } from 'inversify';
import { LogMessageType } from '../../types/enums';

@injectable()
export class ConfigClient {
  private s3: AWS.S3;

  constructor(
    private readonly envConfig: EnvConfig,
    private readonly logger: Logger
  ) {
    AWS.config.update({
      accessKeyId: this.envConfig.AWS_ACCESS_KEY_ID,
      secretAccessKey: this.envConfig.AWS_SECRET_KEY,
      region: this.envConfig.AWS_REGION,
    });

    this.s3 = new AWS.S3();
  }

  public async isObjectAvailable(bucketName: string, key: string): Promise<boolean> {
    try {
      await this.s3.headObject({ Bucket: bucketName, Key: key }).promise();
      return true;
    } catch (e: any) {
      if (e.code !== 'NotFound') {
        this.logger.error({
          type: LogMessageType.S3_CONFIG_CLIENT_ERROR,
          message: `Error while checking if object is available in S3: ${e}`,
        });
      }
      return Promise.resolve(false);
    }
  }

  public async getObject<T>(bucketName: string, key: string): Promise<T> {
    try {
      const object = await this.s3.getObject({ Bucket: bucketName, Key: key }).promise();

      if (object?.Body === undefined) {
        return {} as T;
      }

      return JSON.parse(object.Body.toString());
    } catch (e: any) {
      this.logger.error({
        type: LogMessageType.S3_CONFIG_CLIENT_ERROR,
        message: `Error while getting object from S3: ${e}`,
      });
      return {} as T;
    }
  }

  public async putObject(bucketName: string, key: string, value: any): Promise<void> {
    try {
      await this.s3
        .putObject({
          Bucket: bucketName,
          Key: key,
          Body: JSON.stringify(value),
        })
        .promise();
    } catch (e: any) {
      this.logger.error({
        type: LogMessageType.S3_CONFIG_CLIENT_ERROR,
        message: `Error while putting object to S3: ${e}`,
      });
    }
  }

  public async uploadToS3(
    bucketName: string,
    photoBuffer: Buffer,
    fileName: string
  ): Promise<string> {
    try {
      const params: AWS.S3.PutObjectRequest = {
        Bucket: bucketName,
        Key: fileName,
        Body: photoBuffer,
        ACL: 'public-read',
      };

      const response = await this.s3.upload(params).promise();
      return response.Location;
    } catch (e: any) {
      this.logger.error({
        type: LogMessageType.S3_CONFIG_CLIENT_ERROR,
        message: `Error while uploading to S3: ${e}`,
      });
      return '';
    }
  }
}
