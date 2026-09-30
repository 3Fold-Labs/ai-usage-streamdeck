import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const rootLayers = {
  model: 0,
  identity: 0,
  accounts: 0,
  security: 0,
  platform: 0,
  'last-readings': 0,
  'managed-homes': 0,
  render: 0,
  sources: 2,
  service: 3,
  plugin: 8
};
const runtimeLayers = {
  state: 0,
  bridge: 0,
  store: 4,
  keys: 5,
  'account-actions': 6,
  actions: 7
};
const inspectorLayers = {
  state: 0,
  lib: 1,
  transport: 2,
  dialog: 2,
  colors: 3,
  accounts: 3,
  main: 4
};
export function layer(file) {
  const name = path.posix.basename(file).replace(/\.(?:ts|js)$/, '');
  if (file.startsWith('src/inspector/')) return inspectorLayers[name];
  if (file.startsWith('src/runtime/')) return runtimeLayers[name];
  if (file.startsWith('src/providers/')) return 1;
  if (file.startsWith('src/generated/')) return 0;
  return rootLayers[name];
}
export function inspectGraph(
  graph,
  entries = ['src/plugin.ts', 'src/inspector/main.js']
) {
  const errors = [];
  for (const [file, deps] of graph) {
    if (layer(file) === undefined) errors.push(`Unassigned layer: ${file}`);
    for (const dep of deps) {
      if (!graph.has(dep))
        errors.push(`Unresolved source import: ${file} -> ${dep}`);
      if (layer(dep) > layer(file))
        errors.push(`Upward import: ${file} -> ${dep}`);
      if (
        file.startsWith('src/inspector/') !== dep.startsWith('src/inspector/')
      )
        errors.push(`Cross-runtime import: ${file} -> ${dep}`);
    }
  }
  const reached = new Set(),
    active = new Set();
  function walk(file) {
    if (active.has(file)) {
      errors.push(`Import cycle: ${file}`);
      return;
    }
    if (reached.has(file)) return;
    reached.add(file);
    active.add(file);
    for (const dep of graph.get(file) || []) walk(dep);
    active.delete(file);
  }
  entries.forEach(walk);
  for (const file of graph.keys())
    if (!reached.has(file)) errors.push(`Unused source module: ${file}`);
  return errors;
}
export async function sourceGraph() {
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = dir + '/' + e.name;
      if (e.isDirectory()) await walk(file);
      else if (/\.(?:ts|js)$/.test(e.name)) files.push(file);
    }
  }
  await walk('src');
  const known = new Set(files),
    graph = new Map();
  for (const file of files) {
    const ast = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const deps = [];
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
        continue;
      if (node.isTypeOnly || node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings;
      if (
        !node.importClause?.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length &&
        bindings.elements.every((e) => e.isTypeOnly)
      )
        continue;
      const spec = node.moduleSpecifier?.text;
      if (!spec?.startsWith('.')) continue;
      const relative = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), spec)
      );
      deps.push(
        known.has(relative) ? relative : relative.replace(/\.js$/, '.ts')
      );
    }
    graph.set(file, deps);
  }
  return graph;
}
