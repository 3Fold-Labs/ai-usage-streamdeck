export function layer(file: string): number | undefined;
export function inspectGraph(
  graph: Map<string, string[]>,
  entries?: string[]
): string[];
export function sourceGraph(): Promise<Map<string, string[]>>;
