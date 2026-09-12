import AWS from 'aws-sdk';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { UserState, WatchListItem } from '../../interfaces/user-state.interface';
import { EnvConfig } from '../../env-config';
import { BotStates } from '../../types/enums';
import TelegramBot from 'node-telegram-bot-api';
import { Nullable } from '../../types/types';
import { OrderDto } from '../../strategy/interfaces/order.dto.interface';
import { v4 as uuid4 } from 'uuid';
import { injectable } from 'inversify';

@injectable()
export class DynamoDBClient {
  private docClient: DocumentClient;
  private static instance: DynamoDBClient;

  private constructor(private envConfig: EnvConfig) {
    AWS.config.update({
      accessKeyId: envConfig.AWS_ACCESS_KEY_ID,
      secretAccessKey: envConfig.AWS_SECRET_KEY,
      region: envConfig.AWS_REGION,
    });

    this.docClient = new AWS.DynamoDB.DocumentClient();
  }

  public static getInstance(envConfig: EnvConfig): DynamoDBClient {
    if (!this.instance) {
      this.instance = new DynamoDBClient(envConfig);
    }

    return this.instance;
  }

  async getAllUserStates(): Promise<UserState[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.envConfig.USER_STATE_TABLE_NAME || '',
    };

    try {
      const data = await this.docClient.scan(params).promise();
      return data.Items as UserState[];
    } catch (err) {
      throw new Error(`Error while get all items. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async getUserState(chatId: TelegramBot.ChatId): Promise<Nullable<UserState>> {
    const params: DocumentClient.GetItemInput = {
      TableName: this.envConfig.USER_STATE_TABLE_NAME || '',
      Key: { chatId: chatId.toString() },
    };

    try {
      const data = await this.docClient.get(params).promise();
      return data.Item as UserState;
    } catch (err) {
      throw new Error(`Error while get user state. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async updateDialogState(
    chatId: TelegramBot.ChatId,
    dialogState: BotStates
  ): Promise<void> {
    try {
      await this.docClient
        .update(this.updateUpdateUserStateItemInput<UserState>(chatId, 'dialogState', dialogState))
        .promise();
    } catch (err) {
      throw new Error(`Error while update dialog state. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async addItemToWatchList(
    chatId: TelegramBot.ChatId,
    watchListItem: WatchListItem
  ): Promise<void> {
    const state = await this.getUserState(chatId);
    const old = state?.watchList ? state.watchList : [];
    if (!!old.find(item => item.symbol == watchListItem.symbol && item.timeFrame == watchListItem.timeFrame)) {
      throw new Error(`Item "${watchListItem.symbol} ${watchListItem.timeFrame}" already watched`);
    }

    try {
      await this.updateWatchList(chatId, [...old, watchListItem]);
    } catch (err) {
      throw new Error(`Error while add item to watch list. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async removeItemFromWatchList(
    chatId: TelegramBot.ChatId,
    watchListItem: WatchListItem
  ): Promise<void> {
    const state = await this.getUserState(chatId);
    const old = state?.watchList ? state.watchList : [];

    try {
      await this.updateWatchList(chatId, old.filter(item => !(item.symbol == watchListItem.symbol && item.timeFrame == watchListItem.timeFrame)));
    } catch (err) {
      throw new Error(`Error while remove item from watch list. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async updateWatchList(
    chatId: TelegramBot.ChatId,
    watchList: WatchListItem[]
  ): Promise<void> {
    try {
      await this.docClient
        .update(this.updateUpdateUserStateItemInput<UserState>(chatId, 'watchList', watchList))
        .promise();
    } catch (err) {
      throw new Error(`Error while update watch list. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async updateLastSelectedCrypto(
    chatId: TelegramBot.ChatId,
    lastSelectedCrypto: string[]
  ): Promise<void> {
    try {
      await this.docClient
        .update(
          this.updateUpdateUserStateItemInput<UserState>(chatId, 'lastSelectedCrypto', lastSelectedCrypto)
        )
        .promise();
    } catch (err) {
      throw new Error(`Error while update last selected crypto. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async saveUserState(settings: UserState): Promise<void> {
    const params: DocumentClient.PutItemInput = {
      TableName: this.envConfig.USER_STATE_TABLE_NAME || '',
      Item: {
        ...settings,
      },
    };

    try {
      await this.docClient.put(params).promise();
    } catch (err) {
      throw new Error(`Error while save user state. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async getAllOrders(): Promise<OrderDto[]> {
    const params: DocumentClient.ScanInput = {
      TableName: this.envConfig.ORDER_TABLE_NAME || '',
    };

    try {
      const data = await this.docClient.scan(params).promise();
      return data.Items as OrderDto[];
    } catch (err) {
      throw new Error(`Error while get all orders. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async getOrder(orderId: string): Promise<OrderDto> {
    const params: DocumentClient.GetItemInput = {
      TableName: this.envConfig.ORDER_TABLE_NAME || '',
      Key: { id: orderId },
    };

    try {
      const result = await this.docClient.get(params).promise();
      return result.Item as OrderDto;
    } catch (err) {
      throw new Error(`Error while get order. ${JSON.stringify(err, null, 2)}`);
    }
  }

  public async saveOrder(order: OrderDto): Promise<void> {
    order.id = order.id || uuid4();

    const params: DocumentClient.PutItemInput = {
      TableName: this.envConfig.ORDER_TABLE_NAME || '',
      Item: {
        ...order,
      },
    };

    try {
      await this.docClient.put(params).promise();
    } catch (err) {
      throw new Error(`Error while save order. ${JSON.stringify(err, null, 2)}, \n ${JSON.stringify(order, null, 2)}`);
    }
  }

  public async updateOrder(order: OrderDto): Promise<void> {
    const params: DocumentClient.PutItemInput = {
      TableName: this.envConfig.ORDER_TABLE_NAME || '',
      Item: {
        ...order,
      },
    };

    try {
      await this.docClient.put(params).promise();
    } catch (err) {
      throw new Error(`Error while update order. ${JSON.stringify(err, null, 2)}, ${JSON.stringify(order, null, 2)}`);
    }
  }


  private updateUpdateUserStateItemInput<T>(
    chatId: TelegramBot.ChatId,
    fieldKey: keyof T,
    fieldValue: T[keyof T]
  ): DocumentClient.UpdateItemInput {
    return {
      TableName: this.envConfig.USER_STATE_TABLE_NAME || '',
      Key: { chatId: chatId.toString() },
      UpdateExpression: `set ${fieldKey.toString()} = :fieldValue`,
      ExpressionAttributeValues: {
        ':fieldValue': fieldValue,
      },
      ReturnValues: 'UPDATED_NEW',
    };
  }
}
