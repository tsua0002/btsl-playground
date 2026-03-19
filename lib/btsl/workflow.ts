import type { BTSLSchema } from './types';

export interface WorkflowOrderResult {
  ordered: BTSLSchema[];
  errors: string[];
}

/**
 * Order schemas by OPTIONS.DEPENDS_ON (single-parent chaining).
 * Returns a deterministic topological ordering and validation errors.
 */
export function orderSchemasByDependsOn(schemas: BTSLSchema[]): WorkflowOrderResult {
  const byName = new Map<string, BTSLSchema>();
  for (const s of schemas) byName.set(s.name, s);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: BTSLSchema[] = [];
  const errors: string[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      errors.push(`BTSL_ERR_03: Circular DEPENDS_ON detected at schema ${name}`);
      return;
    }
    const s = byName.get(name);
    if (!s) return;
    visiting.add(name);
    const dep = s.options?.dependsOn;
    if (dep) {
      if (!byName.has(dep)) {
        errors.push(`BTSL_ERR_05: DEPENDS_ON references unknown schema ${dep} (required by ${name})`);
      } else {
        visit(dep);
      }
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(s);
  };

  for (const s of schemas) visit(s.name);

  // Deduplicate while preserving order (in case of multiple references)
  const seen = new Set<string>();
  const unique = ordered.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  return { ordered: unique, errors };
}

