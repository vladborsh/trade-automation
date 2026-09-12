import { CandleChartData } from "../interfaces/charts/candlestick-chart-data";
import { LineTitleLocation, PlotLineStyle } from "./interfaces/plot-line";
import { LineBuilder } from "./tools/line-builder";
import { ScriptVar } from "./tools/script-var";

export function drawPremiumDiscount(lines: LineBuilder, top_x: ScriptVar<number>, btm_x: ScriptVar<number>, trail_up: ScriptVar<number>, trail_dn: ScriptVar<number>, chartData: CandleChartData[]): void {
  lines.make(
    Math.max(top_x.get(), btm_x.get()),
    trail_up.get(),
    chartData.length - 1,
    trail_up.get(),
    '#444444cc',
    PlotLineStyle.SOLID,
    'Premium',
    LineTitleLocation.LEFT_TOP
  );
  const eq_y = 0.5 * trail_up.get() + 0.5 * trail_dn.get();
  lines.make(
    Math.max(top_x.get(), btm_x.get()),
    eq_y,
    chartData.length - 1,
    eq_y,
    '#444444cc',
    PlotLineStyle.SOLID
  );
  lines.make(
    Math.max(top_x.get(), btm_x.get()),
    trail_dn.get(),
    chartData.length - 1,
    trail_dn.get(),
    '#444444cc',
    PlotLineStyle.SOLID,
    'Discount',
    LineTitleLocation.LEFT_BOTTOM
  );
}

export function drawHighPremiumDiscount(lines: LineBuilder, h_top_x: ScriptVar<number>, h_btm_x: ScriptVar<number>, h_trail_up: ScriptVar<number>, h_trail_dn: ScriptVar<number>, chartData: CandleChartData[]): void {
  lines.make(
    Math.max(h_top_x.get(), h_btm_x.get()),
    h_trail_up.get(),
    chartData.length - 1,
    h_trail_up.get(),
    '#555555aa',
    PlotLineStyle.SOLID,
    'HTF Premium',
    LineTitleLocation.LEFT_TOP
  );
  const h_eq_y = 0.5 * h_trail_up.get() + 0.5 * h_trail_dn.get();
  lines.make(Math.max(h_top_x.get(), h_btm_x.get()), h_eq_y, chartData.length - 1, h_eq_y, '#555555aa');
  lines.make(
    Math.max(h_top_x.get(), h_btm_x.get()),
    h_trail_dn.get(),
    chartData.length - 1,
    h_trail_dn.get(),
    '#555555aa',
    PlotLineStyle.SOLID,
    'HTF Discount',
    LineTitleLocation.LEFT_BOTTOM
  );
}
