import { createCanvas, CanvasRenderingContext2D, Canvas } from 'canvas';
import { Order } from '../strategy/order';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { GeneralTimeIntervals } from '../types/enums';
import { format } from 'date-fns';

export class EquityReporter {
  startEquity = 100;
  width = 1000;
  height = 500;
  padding = 50;

  constructor(
    private symbol: string,
    private interval: GeneralTimeIntervals
  ) {}

  renderEquityChart(orders: Order[]): void {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');
    let equity = this.startEquity;

    this.renderBackground(ctx);

    const equityData = orders.map(order => {
      equity += order.riskRewardRate;
      return {
        entryTime: new Date(order.entryTime).getTime(),
        equity,
      };
    });

    equityData.sort((a, b) => a.entryTime - b.entryTime);

    const times = equityData.map(point => point.entryTime);
    const equities = equityData.map(point => point.equity);

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minEquity = Math.min(...equities);
    const maxEquity = Math.max(...equities);

    this.drawAxesWithLabels(ctx, minTime, maxTime, minEquity, maxEquity);

    this.drawEquityCurve(ctx, equityData, minTime, maxTime, minEquity, maxEquity);

    this.saveToFile(canvas);
  }

  renderBackground(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, this.width, this.height);
  }

  saveToFile(canvas: Canvas) {
    const folderName = 'reports';
    const filePath = `./${folderName}/${this.symbol}-${this.interval}-equity-chart.png`;
    if (!existsSync(`./${folderName}`)) {
      mkdirSync(`./${folderName}`);
    }
    const buffer = canvas.toBuffer('image/png');
    writeFileSync(filePath, buffer);
    console.log(`The equity chart was saved as ${filePath}`);
  }

  drawEquityCurve(
    ctx: CanvasRenderingContext2D,
    equityData: { entryTime: number; equity: number }[],
    minTime: number,
    maxTime: number,
    minEquity: number,
    maxEquity: number
  ) {
    ctx.strokeStyle = '#007BFF';
    ctx.lineWidth = 2;

    ctx.beginPath();
    for (let i = 0; i < equityData.length; i++) {
      const currentPoint = equityData[i];
      const nextPoint = equityData[i + 1];

      const x = this.xScale(currentPoint.entryTime, minTime, maxTime);
      const y = this.yScale(currentPoint.equity, minEquity, maxEquity);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else if (nextPoint) {
        const nextX = this.xScale(nextPoint.entryTime, minTime, maxTime);
        const nextY = this.yScale(nextPoint.equity, minEquity, maxEquity);

        const controlX = (x + nextX) / 2;
        const controlY = (y + nextY) / 2;

        ctx.quadraticCurveTo(controlX, controlY, nextX, nextY);
      }
    }
    ctx.stroke();
  }

  drawAxesWithLabels(
    ctx: CanvasRenderingContext2D,
    minTime: number,
    maxTime: number,
    minEquity: number,
    maxEquity: number
  ) {
    // X-axis
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.padding, this.height - this.padding);
    ctx.lineTo(this.width - this.padding, this.height - this.padding);
    ctx.stroke();

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(this.padding, this.padding);
    ctx.lineTo(this.padding, this.height - this.padding);
    ctx.stroke();

    // X-axis Labels
    const timeInterval = (maxTime - minTime) / 7;
    for (let i = 0; i <= 7; i++) {
      const timeValue = minTime + timeInterval * i;
      const x = this.xScale(timeValue, minTime, maxTime);
      const date = new Date(timeValue);
      const label = `${format(date, 'dd/MM/yy')}`; // to format dd/mm/yyyy

      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.font = '10px Arial';
      ctx.fillText(label, x, this.height - this.padding + 20);
    }

    // Y-axis Labels
    const equityInterval = (maxEquity - minEquity) / 5;
    for (let i = 0; i <= 5; i++) {
      const equityValue = minEquity + equityInterval * i;
      const y = this.yScale(equityValue, minEquity, maxEquity);

      ctx.fillStyle = '#000';
      ctx.textAlign = 'right';
      ctx.font = '12px Arial';
      ctx.fillText(equityValue.toFixed(2), this.padding - 10, y + 3);
    }
  }

  xScale(time: number, minTime: number, maxTime: number) {
    return (
      ((time - minTime) / (maxTime - minTime)) * (this.width - 2 * this.padding) + this.padding
    );
  }

  yScale(equity: number, minEquity: number, maxEquity: number) {
    return (
      this.height -
      this.padding -
      ((equity - minEquity) / (maxEquity - minEquity)) * (this.height - 2 * this.padding)
    );
  }
}
