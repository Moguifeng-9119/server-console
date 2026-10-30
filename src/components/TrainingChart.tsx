import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import type { MetricSeries } from '../research/schema';
import 'uplot/dist/uPlot.min.css';

export default function TrainingChart({ series, name, axis }: { series: MetricSeries; name: string; axis: 'time' | 'step' }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null), currentData = useRef<uPlot.AlignedData>([[], [], [], []]);
  const data = useMemo(() => {
    const points = new Map<number, { value: number | null; min: number | null; max: number | null }>();
    for (const point of series.points) {
      const x = axis === 'step' ? point.step : point.at / 1000;
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;
      points.set(x, { value: point.missing ? null : point.value, min: point.min ?? point.value, max: point.max ?? point.value });
    }
    const rows = [...points].sort((a, b) => a[0] - b[0]);
    return [rows.map(([x]) => x), rows.map(([, p]) => p.value), rows.map(([, p]) => p.min), rows.map(([, p]) => p.max)] as uPlot.AlignedData;
  }, [series, axis]);
  currentData.current = data;
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    const chart = new uPlot({ width: Math.max(160, container.clientWidth), height: 290,
      series: [{}, { label: name, stroke: '#408bd7', width: 2, spanGaps: false }, { label: 'min', stroke: '#408bd766', paths: () => null, points: { show: true, size: 3 } }, { label: 'max', stroke: '#408bd766', paths: () => null, points: { show: true, size: 3 } }],
      scales: { x: { time: axis === 'time' } }, axes: [{ stroke: '#7c8a99', grid: { stroke: '#7c8a9928' } }, { stroke: '#7c8a99', grid: { stroke: '#7c8a9928' }, size: 70 }],
      cursor: { drag: { x: true, y: false } }, legend: { show: true },
    }, currentData.current, container);
    plot.current = chart;
    const resize = new ResizeObserver(() => { if (container.clientWidth > 0) chart.setSize({ width: Math.max(160, container.clientWidth), height: 290 }); });
    resize.observe(container);
    return () => { resize.disconnect(); chart.destroy(); plot.current = null; };
  }, [name, axis]);
  useEffect(() => { plot.current?.setData(data); }, [data]);
  return <div ref={host} className="training-chart" role="img" aria-label={`${name} · ${series.total}`} />;
}
