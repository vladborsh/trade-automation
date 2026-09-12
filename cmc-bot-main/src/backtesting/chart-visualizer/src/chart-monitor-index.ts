import { CandleChartData } from '../../../interfaces/charts/candlestick-chart-data';
import { PlotRectangle } from '../../../interfaces/charts/plot-rectangle';
import { ChartRenderableEntities } from '../../../indicator/dto/sm-indicator-response';
import { Plot } from '../../../indicator/interfaces/plot';
import { composeIndicators } from '../../../indicator/indicators-composer';
import { range } from '../../../indicator/tools/range.indicator';
import { VWAP } from '../../../indicator/tools/vwap.indicator';
import { priceAtTime } from '../../../indicator/tools/price-at-time.indicator';
import { RayLine } from '../../../indicator/interfaces/ray-line';
import { PlotLineStyle } from '../../../indicator/interfaces/plot-line';
import { previousHourLH } from '../../../indicator/tools/previous-hour-lh.indicator';

/**
 * ALL THIS FILE IS TESTING AND DEBUGGING PURPOSES ONLY
 */

class CandleChart {
  canvasWidth = 1200;
  canvasHeight = 750;
  canvasPadding = 100;
  canvasPaddingRight = 100;
  candleWidth = 3;
  candlePadding = 1;
  scalePaddingLeft = 10;
  scaleWidth = 50;
  scaleHeight = this.canvasHeight - 20;
  scaleStep = 10;
  defaultPlotColor = '#aaaaaa';
  UP_CANDLE_COLOR = '#41af1c';
  DOWN_CANDLE_COLOR = '#000000';

  /* if number of candles more than canvas can contain, we should start draw candles a bit left from the canvas 0x coordinate */
  backShift = 0;

  /* if number of candles more than canvas can contain, we can render only certain visible candles */
  maxVisibleCandlesNum =
    (this.canvasWidth - this.canvasPaddingRight) / (this.candleWidth + this.candlePadding);
  visibleNumOfCandles = 0;
  visibleCandlesStartIndex = 0;
  visibleCandlesEndIndex = 0;

  private canvas: HTMLCanvasElement;
  renderables: Partial<ChartRenderableEntities> = {};
  private ctx: CanvasRenderingContext2D;
  private data: CandleChartData[] = [];
  private scrollOffset: number = 0;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.setupFileInput();
    this.addScrollListener();
  }

  // Function to set up file input listener
  private setupFileInput(): void {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.addEventListener('change', this.handleFileInput.bind(this));
  }

  private addScrollListener(): void {
    this.canvas.addEventListener('wheel', this.handleWheelScroll.bind(this), {
      passive: true,
    });
  }

  // Handle the wheel event to detect vertical scrolling
  private handleWheelScroll(event: WheelEvent): void {
    const scrollThreshold = 0; // Adjust this threshold as needed

    if (event.deltaY > scrollThreshold) {
      this.scrollRight();
    } else if (event.deltaY < -scrollThreshold) {
      this.scrollLeft();
    }
  }

  // Scroll functions
  private scrollLeft(): void {
    this.scrollOffset += 5;

    this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      this.render(this.renderables.plotRectangles, this.renderables.plots, this.renderables.rayLines);
  }

  private scrollRight(): void {
    this.scrollOffset -= 5;

      this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      this.render(this.renderables.plotRectangles, this.renderables.plots, this.renderables.rayLines);

  }

  private handleFileInput(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const jsonData = JSON.parse(e.target?.result as string);
          if (Array.isArray(jsonData)) {
            this.data = jsonData as CandleChartData[];
            this.data = this.data.slice(0, this.data.length - 200);
            const indicators = [
              {
                code: 'vwap',
                calculate: (v: CandleChartData[]) => VWAP(v),
              },
              {
                code: 'opening',
                calculate: (v: CandleChartData[]) => priceAtTime(v, 9, 30),
              },
              {
                code: 'prevHour',
                calculate: (v: CandleChartData[]) => previousHourLH(v),
              }
            ] as const;

            const response = composeIndicators(indicators, this.data);
            const { vwapBottom, vwap, vwapTop } = response.vwap;

            this.renderables = {
              plots: [
                {
                  values: vwapBottom,
                  color: '#777777',
                  title: 'VWAP bottom',
                },
                {
                  values: vwap,
                  color: '#777700',
                  title: 'VWAP',
                },
                {
                  values: vwapTop,
                  color: '#777777',
                  title: 'VWAP top',
                },
              ],
              rayLines: [
                ...(response.opening
                  ? [{
                    x: response.opening?.x,
                    y: response.opening?.y,
                    color: '#777700',
                    title: 'open',
                  }] : []
                ),
                ...(response.prevHour
                  ? [{
                    x: response.prevHour?.low?.x,
                    y: response.prevHour?.low?.y,
                    color: '#777700',
                    title: 'low',
                  },
                  {
                    x: response.prevHour?.high?.x,
                    y: response.prevHour?.high?.y,
                    color: '#777700',
                    title: 'high',
                  }] : []
                ),
              ],
            };

            this.render(this.renderables.plotRectangles, this.renderables.plots, this.renderables.rayLines);
          } else {
            alert('Invalid JSON format. Please upload an array of candle objects.');
          }
        } catch (error) {
          alert(`Error parsing JSON file. ${error}`);
          console.error('Parse error:', error);
        }
      };
      reader.readAsText(file);
    }
  }

  render(plotRectangles?: PlotRectangle[], plots?: Plot[], rayLines?: RayLine[]) {
    this.backShift = Math.min(
      this.canvasWidth -
      this.data.length * (this.candleWidth + this.candlePadding) -
      this.canvasPaddingRight,
      0
    );

    this.visibleNumOfCandles = Math.min(this.maxVisibleCandlesNum, this.data.length);
    this.visibleCandlesStartIndex = Math.ceil(
      this.data.length - this.visibleNumOfCandles - this.scrollOffset
    );
    this.visibleCandlesEndIndex = this.data.length - this.scrollOffset;

    const maxPrice = Math.max(
      ...this.data
        .slice(this.visibleCandlesStartIndex, this.visibleCandlesEndIndex)
        .map((kline: CandleChartData) => kline.high)
    );
    const minPrice = Math.min(
      ...this.data
        .slice(this.visibleCandlesStartIndex, this.visibleCandlesEndIndex)
        .map((kline: CandleChartData) => kline.low)
    );
    const priceRange = maxPrice - minPrice;
    const priceStep = priceRange / this.scaleStep;

    for (let i = this.visibleCandlesStartIndex; i < this.visibleCandlesEndIndex; i++) {
      if (this.data[i]) {
        this.renderCandle(this.data[i], i - this.visibleCandlesStartIndex, priceRange, minPrice);
      }
    }

    if (plotRectangles) {
      this.renderRectangles(plotRectangles, priceRange, minPrice);
    }

    if (plots) {
      plots.forEach((plot) =>
        this.renderPlot(
          this.data.length - plot.values.length,
          plot.values,
          priceRange,
          minPrice,
        )
      );
    }

    if (rayLines) {
      rayLines.forEach((rayLine) => {
        this.renderRayLine(rayLine, priceRange, minPrice);
      });
    }

    this.renderPriceScale(maxPrice, priceStep);
    this.renderDatetimeLabels(this.visibleNumOfCandles);
  }

  private renderCandle(kline: CandleChartData, index: number, priceRange: number, minPrice: number) {
    const open = kline.open;
    const close = kline.close;
    const high = kline.high;
    const low = kline.low;

    const x = index * (this.candleWidth + this.candlePadding);

    const bodyHeight =
      (Math.abs(open - close) / priceRange) * (this.canvasHeight - this.canvasPadding);
    const wickHeight = ((high - low) / priceRange) * (this.canvasHeight - this.canvasPadding);

    const color = close >= open ? this.UP_CANDLE_COLOR : this.DOWN_CANDLE_COLOR;

    // draw wick
    const wickY =
      this.canvasPadding / 2 +
      (1 - (high - minPrice) / priceRange) * (this.canvasHeight - this.canvasPadding);
    this.ctx.strokeStyle = this.defaultPlotColor;
    this.ctx.beginPath();
    this.ctx.moveTo(x + this.candleWidth / 2, wickY);
    this.ctx.lineTo(x + this.candleWidth / 2, wickY + wickHeight);
    this.ctx.stroke();

    // draw body
    const bodyY =
      close >= open
        ? (1 - (close - minPrice) / priceRange) * (this.canvasHeight - this.canvasPadding)
        : (1 - (open - minPrice) / priceRange) * (this.canvasHeight - this.canvasPadding);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, this.canvasPadding / 2 + bodyY, this.candleWidth, bodyHeight);

    this.ctx.strokeStyle = this.defaultPlotColor;
    this.ctx.strokeRect(x, this.canvasPadding / 2 + bodyY, this.candleWidth, bodyHeight);
  }

  private renderRayLine(
    rayLine: RayLine,
    priceRange: number,
    minPrice: number,
  ) {
    const x1 = (rayLine.x - this.visibleCandlesStartIndex) * (this.candleWidth + this.candlePadding);
    const y1 =
      this.canvasPadding / 2 +
      (1 - (rayLine.y - minPrice) / priceRange) * (this.canvasHeight - this.canvasPadding);
    const x2 = this.canvasWidth;
    const y2 = y1

    if (rayLine.style === PlotLineStyle.DASHED) {
      this.ctx.setLineDash([3, 2]);
    } else if (rayLine.style === PlotLineStyle.DOTTED) {
      this.ctx.setLineDash([1, 1]);
    }
    this.ctx.strokeStyle = rayLine.color || this.defaultPlotColor;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
    /* Unset line dash */
    this.ctx.setLineDash([]);

    if (rayLine.title) {
      this.ctx.font = '16px sans-serif';
      this.ctx.fillStyle = rayLine.color || this.defaultPlotColor;
      this.ctx.fillText(rayLine.title, this.canvasWidth - 100, y1 - 12);
    }
  }

  private renderRectangles(plotRectangles: PlotRectangle[], priceRange: number, minPrice: number) {
    for (const rectangle of plotRectangles) {
      const x = (rectangle.left - this.visibleCandlesStartIndex) * (this.candleWidth + this.candlePadding);
      const y =
        this.canvasPadding / 2 +
        (1 - (rectangle.top - minPrice) / priceRange) * (this.canvasHeight - this.canvasPadding);
      const height =
        ((rectangle.top - rectangle.bottom) / priceRange) *
        (this.canvasHeight - this.canvasPadding);
      const width = (rectangle.right - rectangle.left) * (this.candleWidth + this.candlePadding);

      this.ctx.fillStyle = rectangle.color || '#bbbbbb55';
      this.ctx.fillRect(x, y, width, height);
    }
  }

  private renderPlot(
    shift: number,
    plot: number[],
    priceRange: number,
    minPrice: number,
    color = '#a100ff',
  ) {
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();

    for (let i = this.visibleCandlesStartIndex; i < plot.length + shift; i++) {
      const x = (i - this.visibleCandlesStartIndex) * (this.candleWidth + this.candlePadding);
      const y =
        this.canvasPadding / 2 +
        (1 - (plot[i - shift] - minPrice) / priceRange) * (this.canvasHeight - this.canvasPadding);

      if (i === this.visibleCandlesStartIndex) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }

    this.ctx.stroke();
  }

  private renderPriceScale(maxPrice: number, priceStep: number) {
    this.ctx.font = '12px sans-serif';
    this.ctx.fillStyle = 'black';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';

    for (let i = 0; i <= this.scaleStep; i++) {
      const price = maxPrice - i * priceStep;
      const y = (i / this.scaleStep) * this.scaleHeight + 10 - this.canvasPadding;
      this.ctx.fillText(price.toFixed(2), this.scalePaddingLeft + this.scaleWidth, y);
    }
  }

  private renderDatetimeLabels(limit: number) {
    const labelStep = Math.ceil(limit / 7); // value to control the number of labels displayed

    this.ctx.font = '10px sans-serif';
    this.ctx.fillStyle = 'black';
    this.ctx.textAlign = 'center';

    for (let i = 0; i < limit; i++) {
      if (i % labelStep === 0 && this.data[this.visibleCandlesEndIndex - i]) {
        const timestamp = this.data[this.visibleCandlesEndIndex - i].openTime;
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleString();
        const x =
          this.backShift + (this.data.length - 1 - i) * (this.candleWidth + this.candlePadding);

        this.ctx.fillText(formattedDate, x, this.canvasHeight - 20);
      }
    }
  }

}

const candleChart = new CandleChart('chartCanvas');
