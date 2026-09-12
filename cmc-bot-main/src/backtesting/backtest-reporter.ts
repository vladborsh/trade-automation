import fs from 'fs';
import chalk from 'chalk';
import { parse } from 'json2csv';
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { format } from 'date-fns';
import { GeneralTimeIntervals } from '../types/enums';
import { ChartCanvasRenderer } from '../core/services/chart-canvas-renderer';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { Order } from '../strategy/order';
import { StrategyTemplate } from '../strategy/strategy-template';
import { formatNumber } from '../utils/utils';
import { OrderDirection } from '../strategy/enum/order-direction.enum';
import { EquityReporter } from './equity-reporter';

export interface Statistics {
  totalOrders: number;
  buys: number;
  sells: number;
  failedOrders: number;
  profitOrders: number;
  nonBreakevenOrders: number;
  averageRiskReward: number;
  winRate: number;
  averageProfitPerTrade: number;
}

export class BacktestReporter {
  private LEFT_PADDING = 50;
  private TITLE_FONT_SIZE = 12;
  private TITLE_MARGIN = 5;
  private COMMON_FONT_SIZE = 10;

  constructor(
    private interval: GeneralTimeIntervals,
    private imageRenderer: ChartCanvasRenderer
  ) {}

  public async generateReport(
    startTime: Date,
    endTime: Date,
    strategy: StrategyTemplate,
    symbol: string
  ): Promise<Statistics> {
    printDates(startTime, endTime);

    const statistics = this.generateStatistics(strategy.virtualOrders);

    await this.generatePdfReport( symbol, strategy);

    new EquityReporter(symbol, this.interval).renderEquityChart(strategy.virtualOrders);

    this.generateOrdersCSV(strategy.virtualOrders, symbol);

    return statistics;
  }

  private async generatePdfReport(symbol: string, strategy: StrategyTemplate): Promise<void> {
    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < strategy.virtualOrders.length; i++) {
      const order = strategy.virtualOrders[i];

      if (!order.entryChartSnapshot || !order.closeChartSnapshot) {
        continue;
      }

      const lastCandle =
        order.entryChartSnapshot?.chartData[order.entryChartSnapshot?.chartData.length - 1];

      const page = pdfDoc.addPage();
      const [entryChartImage, closeChartImage] = this.createOrderImage(order);

      this.drawTitle(page, lastCandle, this.getChartImageDescription(order));
      this.drawImages(pdfDoc, page, entryChartImage, closeChartImage);
    }

    const pdfBytes = await pdfDoc.save();

    const folderName = 'reports';
    if (!fs.existsSync(`./${folderName}`)) {
      fs.mkdirSync(`./${folderName}`);
    }
    fs.writeFileSync(`./${folderName}/${symbol}-${this.interval}-report.pdf`, pdfBytes);
    console.log('PDF Generated');
  }

  private getChartImageDescription(order: Order): string {
    const outcome = order.profitable ? 'TAKE PROFIT' : order.isBreakeven ? 'BREAK EVEN' : 'STOP';
    const direction = order.direction === OrderDirection.buy ? 'BUY' : 'SELL';

    return `${direction} (${outcome})`;
  }

  private generateStatistics(orders: Order[]): Statistics {
    const statistics: Statistics = {
      totalOrders: orders.length,
      nonBreakevenOrders: 0,
      buys: 0,
      sells: 0,
      failedOrders: 0,
      profitOrders: 0,
      averageRiskReward: 0,
      winRate: 0,
      averageProfitPerTrade: 0,
    };

    for (const order of orders) {
      if (order.direction === OrderDirection.buy) {
        statistics.buys++;
      } else {
        statistics.sells++;
      }

      if (order.isClosed) {
        if (order.profitable) {
          statistics.profitOrders++;
        } else if (!order.isBreakeven) {
          statistics.failedOrders++;
        }
      }
    }

    statistics.nonBreakevenOrders = statistics.failedOrders + statistics.profitOrders;

    const profitOrders = orders.filter(order => order.profitable);
    const riskRewardSum = profitOrders.reduce((acc, curr) => acc + curr.riskRewardRate, 0);
    statistics.averageRiskReward = riskRewardSum / profitOrders.length;
    statistics.winRate = statistics.profitOrders / statistics.nonBreakevenOrders;
    statistics.averageProfitPerTrade = statistics.winRate * statistics.averageRiskReward - (1 - statistics.winRate);

    console.log(`Total orders: ${statistics.totalOrders}`);
    console.log(`Failed orders: ${statistics.failedOrders}`);
    console.log(`Profit orders: ${statistics.profitOrders}`);
    console.log(`Average risk reward: ${formatNumber(statistics.averageRiskReward)}`);
    console.log(`Win rate: ${Math.ceil(statistics.winRate * 100)}%`);
    console.log(`Average profit per trade: ${formatNumber(statistics.averageProfitPerTrade)}%`);

    return statistics;
  }

  private createOrderImage(order: Order): [Buffer, Buffer] {
    const entryChartImage = this.imageRenderer.generateImage(
      order.entryChartSnapshot?.chartData || [],
      order.entryChartSnapshot?.renderables || {}
    );
    const closeChartImage = this.imageRenderer.generateImage(
      order.closeChartSnapshot?.chartData || [],
      order.closeChartSnapshot?.renderables || {}
    );

    return [entryChartImage, closeChartImage];
  }

  private drawTitle(page: PDFPage, lastCandle: CandleChartData, additionalLegend: string): void {
    const titleText = `${format(lastCandle.openTime, 'yyyy-MM-dd')} ${additionalLegend}`;

    page.drawText(titleText, {
      x: this.LEFT_PADDING,
      y: page.getHeight() - this.TITLE_FONT_SIZE - this.TITLE_MARGIN,
      size: this.COMMON_FONT_SIZE,
      color: rgb(0, 0, 0),
    });
  }

  private async drawImages(
    document: PDFDocument,
    page: PDFPage,
    bufferImage1: Buffer,
    bufferImage2: Buffer
  ): Promise<void> {
    const { width, height } = page.getSize();
    const [image1Embed, image2Embed] = [
      await document.embedPng(bufferImage1),
      await document.embedPng(bufferImage2),
    ];

    const imageHeight = page.getHeight() / 2 - this.TITLE_FONT_SIZE - this.TITLE_MARGIN;
    page.drawImage(image1Embed, {
      x: this.LEFT_PADDING,
      y: height / 2,
      width: width - this.LEFT_PADDING,
      height: imageHeight,
    });
    page.drawImage(image2Embed, {
      x: this.LEFT_PADDING,
      y: 0,
      width: width - this.LEFT_PADDING,
      height: imageHeight,
    });
  }

  private simulateStrategyProfit(estimatedProfitPerTrade: number): void {
    let startValue = 100;
    let dep = startValue;
    for (let i = 0; i < 100; i++) {
      dep += (dep * estimatedProfitPerTrade) / 100;
    }
    console.log(`Profit per 100 trades: ${formatNumber(dep - startValue)}%`);
  }

  private generateOrdersCSV(orders: Order[], symbol): void {
    const jsonData: any[] = [];

    for (let order of orders) {
      jsonData.push({
        fail: !order.profitable && !order.isBreakeven,
        vwapRange: Number(order.analytics.vwapRange).toFixed(3),
        atr: Number(order.analytics.atr).toFixed(3),
        vwapAtrRatio: Number(order.analytics.vwapAtrRatio).toFixed(3),
        vwapDistanceRatio: Number(order.analytics.vwapDistanceRatio).toFixed(3),
        entryTime: new Date(order.entryTime).toLocaleString(),
        entry: order.entryPrice.toFixed(2),
        stop: order.stopLossPrice.toFixed(2),
        take: order.takeProfitPrice.toFixed(2),
        direction: order.direction,
        risk: order.riskRewardRate,
        profit: order.profitable,
      });
    }
    const csv = parse(jsonData);

    const folderName = 'reports';
    if (!fs.existsSync(`./${folderName}`)) {
      fs.mkdirSync(`./${folderName}`);
    }
    const filePath = `./${folderName}/${symbol}-${this.interval}-csv.csv`;
    fs.writeFileSync(filePath, csv);
  }
}

function printDates(startTime: Date, endTime: Date): void {
  const startDate = format(startTime, 'yyyy-MM-dd');
  const endDate = format(endTime, 'yyyy-MM-dd');

  console.log(chalk.yellow(`\n\nBacktest ===== [Start: ${startDate} - End: ${endDate}] =====\n`));
}
