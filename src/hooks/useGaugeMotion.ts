import { useEffect, useRef } from 'react';

export interface MotionItem {
  id: string;
  target: number;
  current: number;
  element: SVGCircleElement | null;
  onUpdate?: (value: number) => void;
}

class MotionEngine {
  private items = new Map<string, MotionItem>();
  private rafId: number | null = null;
  private lastTime = 0;
  private tau = 100; // 100ms smoothing time constant
  private reducedMotion = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = mq.matches;
      mq.addEventListener?.('change', (e) => {
        this.reducedMotion = e.matches;
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stop();
        } else {
          // Snap immediately on resume to prevent large dt jumps
          this.snapAll();
        }
      });
    }
  }

  public register(item: MotionItem) {
    this.items.set(item.id, item);
    this.applyValue(item, item.current);
    this.ensureRunning();
  }

  public updateTarget(id: string, target: number) {
    const item = this.items.get(id);
    if (!item) return;
    item.target = Math.max(0, Math.min(100, target));

    if (this.reducedMotion) {
      item.current = item.target;
      this.applyValue(item, item.current);
      return;
    }

    if (Math.abs(item.current - item.target) > 0.01) {
      this.ensureRunning();
    }
  }

  public unregister(id: string) {
    this.items.delete(id);
    if (this.items.size === 0) {
      this.stop();
    }
  }

  private snapAll() {
    for (const item of this.items.values()) {
      item.current = item.target;
      this.applyValue(item, item.current);
    }
  }

  private applyValue(item: MotionItem, value: number) {
    if (item.element) {
      item.element.setAttribute('stroke-dasharray', `${value.toFixed(1)} 100`);
    }
    item.onUpdate?.(value);
  }

  private ensureRunning() {
    if (this.rafId !== null || typeof window === 'undefined' || document.hidden) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loop = (now: number) => {
    let activeCount = 0;
    const rawDt = now - this.lastTime;
    this.lastTime = now;

    // Discard huge dt (e.g. browser freeze or tab switch) by clamping dt to max 100ms
    const dt = Math.min(Math.max(rawDt, 1), 100);
    const factor = 1 - Math.exp(-dt / this.tau);

    for (const item of this.items.values()) {
      const diff = item.target - item.current;
      if (Math.abs(diff) < 0.05) {
        if (item.current !== item.target) {
          item.current = item.target;
          this.applyValue(item, item.current);
        }
      } else {
        item.current += diff * factor;
        this.applyValue(item, item.current);
        activeCount++;
      }
    }

    if (activeCount > 0) {
      this.rafId = requestAnimationFrame(this.loop);
    } else {
      this.rafId = null;
    }
  };
}

export const sharedMotionEngine = new MotionEngine();

/**
 * Hook to smoothly animate an SVG circle gauge using the shared RAF engine.
 */
export function useGaugeMotion(
  id: string,
  targetValue: number,
  circleRef: React.RefObject<SVGCircleElement | null>,
  onUpdate?: (value: number) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const initialTargetRef = useRef(targetValue);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(100, initialTargetRef.current));
    const item: MotionItem = {
      id,
      target: clamped,
      current: clamped,
      element: circleRef.current,
      onUpdate: (v) => onUpdateRef.current?.(v),
    };

    sharedMotionEngine.register(item);
    return () => {
      sharedMotionEngine.unregister(id);
    };
  }, [id, circleRef]);

  useEffect(() => {
    sharedMotionEngine.updateTarget(id, targetValue);
  }, [id, targetValue]);
}
