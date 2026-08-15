import {
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
  Coordinate,
} from 'lightweight-charts';

export interface RectangleOptions {
  id?: string;
  p1: { time: Time; price: number };
  p2: { time: Time; price: number };
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  label?: string;
  extendRight?: boolean;
}

type CanvasTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

class RectanglePaneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _p1: { x: Coordinate | null; y: Coordinate | null },
    private _p2: { x: Coordinate | null; y: Coordinate | null },
    private _options: Required<Omit<RectangleOptions, 'p1' | 'p2'>>
  ) {}

  draw(target: CanvasTarget) {
    if (this._p1.y === null || this._p2.y === null) return;

    // Handle off-screen X coordinates gracefully during panning
    let x1 = this._p1.x;
    let x2 = this._p2.x;

    if (x1 === null && x2 === null) return;
    if (x1 === null) x1 = -2000 as Coordinate;
    if (x2 === null) x2 = (this._options.extendRight ? 10000 : x1 + 500) as Coordinate;

    const minX = Math.min(x1, x2);
    const minY = Math.min(this._p1.y, this._p2.y);
    const width = Math.abs(x1 - x2);
    const height = Math.abs(this._p1.y - this._p2.y);

    target.useBitmapCoordinateSpace((scope: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number }) => {
      const ctx = scope.context;
      const scaledX = minX * scope.horizontalPixelRatio;
      const scaledY = minY * scope.verticalPixelRatio;
      const scaledWidth = width * scope.horizontalPixelRatio;
      const scaledHeight = height * scope.verticalPixelRatio;

      // Draw Fill
      ctx.fillStyle = this._options.fillColor;
      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);

      // Draw Border
      if (this._options.borderWidth > 0) {
        ctx.strokeStyle = this._options.borderColor;
        ctx.lineWidth = this._options.borderWidth * scope.verticalPixelRatio;
        ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);
      }

      // Draw Label
      if (this._options.label) {
        ctx.font = `${11 * scope.verticalPixelRatio}px monospace`;
        ctx.fillStyle = this._options.borderColor;
        ctx.fillText(this._options.label, scaledX + 8 * scope.horizontalPixelRatio, scaledY + 14 * scope.verticalPixelRatio);
      }
    });
  }
}

class RectanglePaneView implements IPrimitivePaneView {
  constructor(private _source: RectanglePlugin) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    const p1 = this._source.getPointCoordinates(this._source.options.p1);
    const p2 = this._source.getPointCoordinates(this._source.options.p2);
    return new RectanglePaneRenderer(p1, p2, {
      id: this._source.options.id ?? '',
      fillColor: this._source.options.fillColor ?? 'rgba(16, 185, 129, 0.2)',
      borderColor: this._source.options.borderColor ?? '#10b981',
      borderWidth: this._source.options.borderWidth ?? 1,
      label: this._source.options.label ?? '',
      extendRight: this._source.options.extendRight ?? false,
    });
  }
}

export class RectanglePlugin implements ISeriesPrimitive<Time> {
  private _attachedParams: SeriesAttachedParameter<Time> | null = null;
  private _paneViews: RectanglePaneView[];

  constructor(public options: RectangleOptions) {
    this._paneViews = [new RectanglePaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._attachedParams = param;
  }

  detached() {
    this._attachedParams = null;
  }

  updateAllViews() {
    this._paneViews = [new RectanglePaneView(this)];
  }

  paneViews() {
    return this._paneViews;
  }

  getPointCoordinates(p: { time: Time; price: number }) {
    if (!this._attachedParams) return { x: null, y: null };
    const { chart, series } = this._attachedParams;
    const x = chart.timeScale().timeToCoordinate(p.time);
    const y = series.priceToCoordinate(p.price);

    return { x, y };
  }

  applyOptions(options: Partial<RectangleOptions>) {
    this.options = { ...this.options, ...options };
    this._attachedParams?.requestUpdate();
  }

  requestUpdate() {
    this._attachedParams?.requestUpdate();
  }
}