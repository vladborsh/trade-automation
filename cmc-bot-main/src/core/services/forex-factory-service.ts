import axios from 'axios';
import {
  ForexFactoryNews,
  NewsCountryType,
  NewsImpactType,
} from '../../interfaces/forex-factory-news.interface';
import { differenceInSeconds, getDay, isToday, parseISO } from 'date-fns';
import { Observable, Observer, Subject } from 'rxjs';
import { format, utcToZonedTime } from 'date-fns-tz';
import { Logger } from 'winston';
import { LogMessageType } from '../../types/enums';
import { injectable } from 'inversify';
import { ConfigClient } from './config-client';

const TIMEZONE = 'America/New_York';

@injectable()
export class ForexFactoryTask {
  private MAIN_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  private NEWS_IMPACT_FILTER = [NewsImpactType.HIGH, NewsImpactType.HOLIDAY];
  private NEWS_COUNTRY_FILTER = [NewsCountryType.USD, NewsCountryType.EUR, NewsCountryType.GBP];
  private newsChannel$ = new Subject<string>();
  private readonly INTERVAL_BEFORE_NEWS = 5;

  constructor(
    private readonly configClient: ConfigClient,
    private readonly logger: Logger
  ) {}

  public getNewsChannel$(): Observable<string> {
    return this.newsChannel$.asObservable();
  }

  public async execute(): Promise<void> {
    try {
      const news = await this.getNewsData();

      const newsNotification = this.filterTodaysNewsData(news);

      if (newsNotification.length > 0) {
        this.emitCurrentNews(newsNotification, this.newsChannel$);
      }
    } catch (e) {
      this.logger.error({
        type: LogMessageType.FOREX_FACTORY_ERROR,
        message: `Error while interval. ${e as any}`,
      });
    }
  }

  public async getNewsData(): Promise<ForexFactoryNews[]> {
    const isAvailable = await this.configClient.isObjectAvailable(this.bucketName, this.configName);

    if (!isAvailable) {
      const data = await this.getNewsDataFromForexFactory();
      await this.configClient.putObject(this.bucketName, this.configName, data);

      return data;
    }

    const data = await this.configClient.getObject<ForexFactoryNews[]>(
      this.bucketName,
      this.configName
    );

    return data;
  }

  public async getNewsDataFromForexFactory(): Promise<ForexFactoryNews[]> {
    try {
      const response = await axios.get<ForexFactoryNews[]>(this.MAIN_URL);
      return response.data;
    } catch (e) {
      this.logger.error({
        type: LogMessageType.FOREX_FACTORY_ERROR,
        message: `Error while fetching news data from Forex Factory. ${(e as any).code}`,
      });
      return [];
    }
  }

  private get bucketName(): string {
    return 'telegram-bot-config';
  }

  private get configName(): string {
    return `${this.getCurrentDateString()}-news_data.json`;
  }

  private isWeekStart(): boolean {
    const currentDate = new Date();
    const currentDayOfWeek = getDay(currentDate);

    return currentDayOfWeek === 1;
  }

  private getCurrentDateString(): string {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentDay = new Date().getDate();

    return `${currentYear}-${currentMonth}-${currentDay}`;
  }

  private filterTodaysNewsData(data: ForexFactoryNews[]): ForexFactoryNews[] {
    return data.filter(
      news =>
        this.NEWS_IMPACT_FILTER.includes(news.impact) &&
        this.NEWS_COUNTRY_FILTER.includes(news.country) &&
        isToday(parseISO(news.date)) &&
        this.checkIfLessThanMinutes(news.date, this.INTERVAL_BEFORE_NEWS)
    );
  }

  private emitCurrentNews(data: ForexFactoryNews[], observer: Observer<string>): void {
    data.forEach(news => {
      observer.next(this.getMessageForNews(news));
    });
  }

  private checkIfLessThanMinutes(targetTime: string, minutesDifference: number): boolean {
    const currentTime = new Date();
    const currentTimeNYZoned = utcToZonedTime(currentTime, TIMEZONE);
    const targetNYZoned = utcToZonedTime(parseISO(targetTime), TIMEZONE);
    const diffInSeconds = differenceInSeconds(targetNYZoned, currentTimeNYZoned);
    const secondsDifference = minutesDifference * 60;
    const secondsDifferenceLower = (minutesDifference - 1) * 60;
    const isLessThan5Min =
      diffInSeconds <= secondsDifference && diffInSeconds > secondsDifferenceLower;

    return isLessThan5Min;
  }

  private getMessageForNews(newsItem: ForexFactoryNews): string {
    if (newsItem.impact === NewsImpactType.HOLIDAY) {
      return this.getMessageForHolidayNews(newsItem);
    }
    if (newsItem.impact === NewsImpactType.HIGH) {
      return this.getMessageForHighPriorityNews(newsItem);
    }

    throw new Error(`Unknown impact type: ${newsItem.impact}`);
  }

  private getMessageForHolidayNews(newsItem: ForexFactoryNews): string {
    let message = `*🏝 ${newsItem.country} News*: ${newsItem.title}\n`;

    return message;
  }

  private getMessageForHighPriorityNews(newsItem: ForexFactoryNews): string {
    let message = `*⚡️ ${newsItem.country} News*: ${newsItem.title}\n`;

    if (newsItem.forecast && newsItem.previous) {
      message = message.concat(`Forecast: ${newsItem.forecast}\n`);
      message = message.concat(`Previous: ${newsItem.previous}\n`);
    }

    message = message.concat(
      `Date: ${formatNoZone(utcToZonedTime(parseISO(newsItem.date), TIMEZONE))}\n`
    );

    return message;
  }
}

const formatNoZone = (date: Date) => format(date, 'yyyy-MM-dd HH:mm');
