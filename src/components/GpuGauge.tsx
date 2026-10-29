import { useRef } from 'react';
import type { Gpu } from '../types';
import { useGaugeMotion } from '../hooks/useGaugeMotion';
import { useTranslation } from 'react-i18next';

export interface GpuGaugeProps {
  id: string;
  gpu: Gpu;
  online: boolean;
  fresh: boolean;
  color: string;
  isMatch?: boolean;
  owners?: string[];
  freeGiBVal?: number;
  onClick?: () => void;
}

export function GpuGauge({
  id,
  gpu,
  online,
  fresh,
  color,
  isMatch,
  owners = [],
  freeGiBVal,
  onClick,
}: GpuGaugeProps) {
  const { t } = useTranslation();
  const circleRef = useRef<SVGCircleElement>(null);
  const utilizationKnown = !gpu.unavailableMetrics?.includes('util');
  const memoryKnown = !gpu.unavailableMetrics?.some((metric) => metric === 'memUsed' || metric === 'memTotal');
  const targetUtil = online && fresh && utilizationKnown ? Math.max(0, Math.min(100, gpu.util)) : 0;

  useGaugeMotion(id, targetUtil, circleRef);

  const ownerText = owners.join(', ') || t('workbench.noProcesses');
  const memUsedGiB = (gpu.memUsed / 1024).toFixed(1);
  const memTotalGiB = (gpu.memTotal / 1024).toFixed(0);
  const isAvailable = online && fresh;

  return (
    <button
      type="button"
      className={`resource-gpu ${isMatch ? 'matches' : ''}`}
      data-free-gib={isAvailable && freeGiBVal != null && Number.isFinite(freeGiBVal) ? freeGiBVal : undefined}
      onClick={onClick}
      disabled={!isAvailable}
      title={ownerText}
      aria-label={`GPU ${gpu.index} · ${t('monitor.util')} ${isAvailable && utilizationKnown ? `${Math.round(gpu.util)}%` : '—'}`}
    >
      <span className="gpu-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="42" className="gpu-ring-track" />
          <circle
            ref={circleRef}
            cx="50"
            cy="50"
            r="42"
            className="gpu-ring-value"
            pathLength="100"
            style={{ stroke: isAvailable ? color : 'var(--text-faint)' }}
          />
        </svg>
        <span className="gpu-ring-label">
          <span>GPU {gpu.index}</span>
          <strong className="num">{isAvailable && utilizationKnown ? `${Math.round(gpu.util)}%` : '—'}</strong>
        </span>
      </span>
      <span className="gpu-ring-memory mono">
        {isAvailable && memoryKnown ? `${memUsedGiB} / ${memTotalGiB}` : '—'} GiB
      </span>
      <span className="gpu-ring-temp">
        {t('monitor.temp')} {isAvailable && !gpu.unavailableMetrics?.includes('temp') && gpu.temp != null ? `${gpu.temp}°C` : '—'}
      </span>
      <span className="resource-owner">
        {isAvailable ? ownerText : '—'}
      </span>
    </button>
  );
}
