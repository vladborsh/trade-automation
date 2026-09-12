import { prepareString } from "./formatting";
import { DynamicConfigValues } from "../interfaces/dynamic-config.interface";
import { NewsArticle } from "../interfaces/news-article.interface";

export class CryptopanicNewsMapper {
  constructor(private config: DynamicConfigValues) {}

  processDayTradingNews(newsByAsset: Record<string, NewsArticle[]>) {
    return Object.entries(newsByAsset).reduce((res, [asset, news]) => {
      const filteredByDateNews = news.filter((article) =>
        this.validateDate(article.created_at, this.config.NEWS_AGE_DAYS_LIMIT)
      );

      if (!filteredByDateNews.length) {
        return res;
      }

      let message = `\n*${asset}*:\n\n`;

      for (let i = 0; i < this.config.NEWS_NUMBER && i < filteredByDateNews.length; i++) {
        message += `${prepareString(filteredByDateNews[i].title).replace(
          /\n/g,
          '\\|'
        )}\n${prepareString(filteredByDateNews[i].url)}\n\n`;
      }

      return res.concat(message);
    }, 'News for day trading: \n');
  }

  validateDate(date: string, daysLimit: number): boolean {
    const pickedDate = new Date(date);
    const todaysDate = new Date();
    todaysDate.setHours(0, 0, 0, 0);
    const dateDifference = Math.abs(Number(todaysDate) - Number(pickedDate));

    if (dateDifference > 1000 * 60 * 60 * 24 * daysLimit) {
      return false;
    } else {
      return true;
    }
  }
}
