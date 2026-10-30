import { z } from 'zod';
export const itemIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const runStatusSchema = z.enum(['prepared', 'starting', 'running', 'unknown', 'succeeded', 'failed', 'stopped']);
export const runInputSchema = z.object({
  id: itemIdSchema.optional(), serverId: itemIdSchema, workspaceId: itemIdSchema.nullish(), taskId: itemIdSchema.nullish(),
  name: z.string().trim().min(1).max(160), command: z.string().max(65536).default(''),
  cwd: z.string().max(4096).refine((v) => v === '~' || v.startsWith('/')).default('~'),
  gpu: z.string().max(2048).default(''),
  parameters: z.record(z.string().max(120), z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])).default({}),
  totalSteps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish(), status: runStatusSchema.default('prepared'), startedAt: timestampSchema.nullish(),
});
export const metricPointSchema = z.object({ runId: itemIdSchema, name: z.string().regex(/^[A-Za-z][A-Za-z0-9_./-]{0,79}$/), value: z.number().finite().nullable(), at: timestampSchema, step: z.number().finite().nonnegative().nullable(), source: z.string().min(1).max(200), sourceId: z.string().min(1).max(300) });
export const runFormSchema = z.object({ name: runInputSchema.shape.name, command: z.string().trim().min(1).max(65536), cwd: z.string().max(4096).startsWith('/'), gpu: z.string().max(2048).regex(/^[a-zA-Z0-9,._/-]*$/), totalSteps: z.string().max(16).regex(/^(?:[1-9]\d*)?$/), parameters: z.string().max(65536).refine((v) => { try { return runInputSchema.shape.parameters.safeParse(JSON.parse(v)).success; } catch { return false; } }) });
export type RunDraft = z.infer<typeof runFormSchema>;
export type RunInput = z.infer<typeof runInputSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type MetricPoint = z.infer<typeof metricPointSchema>;
export type Run = RunInput & { id: string; status: RunStatus; createdAt: number; updatedAt: number; finishedAt: number | null; exitCode: number | null; lastError?: string | null; summary?: Array<{ name: string; value: number | null; at: number; step: number | null }>; events?: Array<{ id: string; kind: string; evidence: string; at: number }> };
export type MetricSeries = { points: Array<{ at: number; step?: number | null; value: number | null; min?: number | null; max?: number | null; missing?: number }>; total: number; downsampled: boolean };
