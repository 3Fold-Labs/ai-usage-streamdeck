export function releaseBudget(options?: {
  request?: typeof fetch;
  repository?: string;
  token?: string;
  runId?: string;
  attempt?: number;
  now?: Date;
  limit?: number;
}): Promise<{ spent: number; reserved: number; limit: number }>;
