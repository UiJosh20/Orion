import {
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
  Coordinate,
  MouseEventHandler,
} from 'lightweight-charts';

export interface PositionOptions {
  id: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  target: number;
  stopLoss: number;
  startTime: Time;
  durationBars?: number;
  targetColor?: string;
  targetBorderColor?: string;
  stopColor?: string;
  stopBorderColor?: string;
  onCancel?: (id: string) => void;
}

type CanvasTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

class PositionPaneRenderer implements IPrimitivePaneRenderer {
  public closeButtonBounds: { x: number; y: number; width: number; height: number } | null = null;

  constructor(
    private _pEntry: { x: Coordinate | null; y: Coordinate | null },
    private _pTarget: { y: Coordinate | null },
    private _pStop: { y: Coordinate | null },
    private _pEnd: { x: Coordinate | null },
    private _options: PositionOptions
  ) {}

  draw(target: CanvasTarget) {
    if (!this._pEntry.x || !this._pEntry.y || !this._pTarget.y || !this._pStop.y || !this._pEnd.x) return;

    const yEntry = this._pEntry.y;
    const yTarget = this._pTarget.y;
    const yStop = this._pStop.y;
    const xStart = this._pEntry.x;
    const xEnd = this._pEnd.x;

    if (isNaN(yEntry) || isNaN(yTarget) || isNaN(yStop)) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;

      const scaledXStart = xStart * hRatio;
      const scaledXEnd = xEnd * hRatio;
      const scaledX = Math.min(scaledXStart, scaledXEnd);
      const scaledWidth = Math.max(Math.abs(scaledXStart - scaledXEnd), 70 * hRatio);

      const scaledYEntry = yEntry * vRatio;
      const scaledYTarget = yTarget * vRatio;
      const scaledYStop = yStop * vRatio;

      // Target Box
      const targetMinY = Math.min(scaledYEntry, scaledYTarget);
      const targetHeight = Math.abs(scaledYEntry - scaledYTarget);
      ctx.fillStyle = this._options.targetColor ?? 'rgba(38, 166, 154, 0.2)';
      ctx.fillRect(scaledX, targetMinY, scaledWidth, targetHeight);
      ctx.strokeStyle = this._options.targetBorderColor ?? '#26a69a';
      ctx.lineWidth = 1 * vRatio;
      ctx.strokeRect(scaledX, targetMinY, scaledWidth, targetHeight);

      // Stop Loss Box
      const stopMinY = Math.min(scaledYEntry, scaledYStop);
      const stopHeight = Math.abs(scaledYEntry - scaledYStop);
      ctx.fillStyle = this._options.stopColor ?? 'rgba(239, 83, 80, 0.2)';
      ctx.fillRect(scaledX, stopMinY, scaledWidth, stopHeight);
      ctx.strokeStyle = this._options.stopBorderColor ?? '#ef5350';
      ctx.lineWidth = 1 * vRatio;
      ctx.strokeRect(scaledX, stopMinY, scaledWidth, stopHeight);

      // Entry Line
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5 * vRatio;
      ctx.beginPath();
      ctx.moveTo(scaledX, scaledYEntry);
      ctx.lineTo(scaledX + scaledWidth, scaledYEntry);
      ctx.stroke();

      // Metrics
      const riskDist = Math.abs(this._options.entry - this._options.stopLoss);
      const rewardDist = Math.abs(this._options.target - this._options.entry);
      const rrRatio = riskDist > 0 ? (rewardDist / riskDist).toFixed(2) : '0.00';
      const targetPct = ((rewardDist / this._options.entry) * 100).toFixed(2);
      const stopPct = ((riskDist / this._options.entry) * 100).toFixed(2);

      const fontSize = Math.max(9, 10 * vRatio);
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';

      ctx.fillStyle = '#10b981';
      ctx.fillText(`Target: ${this._options.target.toFixed(2)} (+${targetPct}%)`, scaledX + 6 * hRatio, targetMinY + 6 * vRatio);

      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${this._options.side} @ ${this._options.entry.toFixed(2)} | R:R ${rrRatio}`, scaledX + 6 * hRatio, scaledYEntry - fontSize - 4 * vRatio);

      ctx.fillStyle = '#ef4444';
      ctx.fillText(`Stop: ${this._options.stopLoss.toFixed(2)} (-${stopPct}%)`, scaledX + 6 * hRatio, Math.max(scaledYEntry, scaledYStop) + 6 * vRatio);

      // Cancel Button
      const btnWidth = 18 * hRatio;
      const btnHeight = 18 * vRatio;
      const btnX = scaledX + scaledWidth - btnWidth - 6 * hRatio;
      const btnY = scaledYEntry - btnHeight / 2;

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(btnX + btnWidth / 2, btnY + btnHeight / 2, btnWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1 * vRatio;
      ctx.stroke();

      ctx.fillStyle = '#f1f5f9';
      ctx.font = `bold ${10 * vRatio}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', btnX + btnWidth / 2, btnY + btnHeight / 2);

      this.closeButtonBounds = {
        x: btnX / hRatio,
        y: btnY / vRatio,
        width: btnWidth / hRatio,
        height: btnHeight / vRatio,
      };
    });
  }
}

class PositionPaneView implements IPrimitivePaneView {
  private _renderer: PositionPaneRenderer | null = null;

  constructor(private _source: PositionPlugin) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    const coords = this._source.getCoordinates();
    this._renderer = new PositionPaneRenderer(
      coords.pEntry,
      coords.pTarget,
      coords.pStop,
      coords.pEnd,
      this._source.options
    );
    return this._renderer;
  }

  getRenderer(): PositionPaneRenderer | null {
    return this._renderer;
  }
}

export class PositionPlugin implements ISeriesPrimitive<Time> {
  private _attachedParams: SeriesAttachedParameter<Time> | null = null;
  private _paneView: PositionPaneView;

  constructor(public options: PositionOptions) {
    this._paneView = new PositionPaneView(this);
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._attachedParams = param;
    param.chart.subscribeClick(this._handleChartClick);
  }

  detached() {
    if (this._attachedParams) {
      this._attachedParams.chart.unsubscribeClick(this._handleChartClick);
      this._attachedParams = null;
    }
  }

  private _handleChartClick = (param: Parameters<MouseEventHandler<Time>>[0]) => {
    if (!param.point || !this.options.onCancel) return;
    const renderer = this._paneView.getRenderer();
    const bounds = renderer?.closeButtonBounds;

    if (bounds) {
      const clickX = param.point.x;
      const clickY = param.point.y;

      if (
        clickX >= bounds.x &&
        clickX <= bounds.x + bounds.width &&
        clickY >= bounds.y &&
        clickY <= bounds.y + bounds.height
      ) {
        this.options.onCancel(this.options.id);
      }
    }
  };

  updateAllViews() {
    this._paneView = new PositionPaneView(this);
  }

  paneViews() {
    return [this._paneView];
  }

  getCoordinates() {
    if (!this._attachedParams) {
      return { pEntry: { x: null, y: null }, pTarget: { y: null }, pStop: { y: null }, pEnd: { x: null } };
    }

    const { chart, series } = this._attachedParams;
    const timeScale = chart.timeScale();

    // ✅ CORRECT: Use timeToCoordinate directly (no logical conversions needed)
    const xStart = timeScale.timeToCoordinate(this.options.startTime);
    let xEnd: Coordinate | null = null;

    if (xStart !== null) {
      // Simple fallback: 150px width
      xEnd = (xStart + 150) as Coordinate;
    }

    const yEntry = series.priceToCoordinate(this.options.entry);
    const yTarget = series.priceToCoordinate(this.options.target);
    const yStop = series.priceToCoordinate(this.options.stopLoss);

    return {
      pEntry: { x: xStart, y: yEntry },
      pTarget: { y: yTarget },
      pStop: { y: yStop },
      pEnd: { x: xEnd },
    };
  }

  applyOptions(options: Partial<PositionOptions>) {
    this.options = { ...this.options, ...options };
    this._attachedParams?.requestUpdate();
  }
}