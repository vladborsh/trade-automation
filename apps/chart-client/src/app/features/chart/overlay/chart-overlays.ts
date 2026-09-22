import { LineRenderer } from './line.renderer';
import { MarkerRenderer } from './marker.renderer';
import { OverlayLayer } from './overlay-layer';
import { PriceLineRenderer } from './price-line.renderer';
import { RayRenderer } from './ray.renderer';
import { RectRenderer } from './rect.renderer';
import type { ShapesPrimitive } from './shapes.primitive';

/** A chart's overlay layer with every renderer (§5.2) registered — moved out of `ChartComponent` unchanged. */
export function createOverlayLayer(shapes: ShapesPrimitive): OverlayLayer {
  const layer = new OverlayLayer();
  layer.register(new MarkerRenderer());
  layer.register(new PriceLineRenderer());
  layer.register(new RectRenderer(shapes));
  layer.register(new RayRenderer(shapes));
  layer.register(new LineRenderer(shapes));
  return layer;
}
