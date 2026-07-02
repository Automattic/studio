import { pathResolvesToValidRole } from './_design-foundation-shared.js';
import type { Handler } from '../handler-types.js';

export const designFoundationValidateHandler: Handler = async (args, ctx) => {
  const foundation = args.foundation;
  const start = Date.now();
  const { DesignFoundationSchema } = await import('../../lib/design-foundation/schema.js');
  const parsed = DesignFoundationSchema.safeParse(foundation);
  const result: { ok: boolean; errors?: unknown[] } = { ok: parsed.success };
  if (!parsed.success) result.errors = parsed.error.issues;

  // skillTodos ack check: when schema passes, verify every path listed in
  // skillTodos resolves to a non-null, non-"TODO" value in the filled
  // foundation. Catches a skill that silently leaves slots unfilled.
  if (parsed.success) {
    const f = parsed.data;
    const unfilled: string[] = [];
    for (const path of f.skillTodos) {
      if (!pathResolvesToValidRole(f, path)) unfilled.push(path);
    }
    if (unfilled.length > 0) {
      result.ok = false;
      result.errors = unfilled.map((p) => ({
        code: 'skill_todo_unfilled',
        path: p.split('.'),
        message: `skillTodos entry "${p}" is still empty or TODO`,
      }));
    }
  }

  console.error(`[design-foundation] ${JSON.stringify({
    tool: 'validate', ok: result.ok, durationMs: Date.now() - start, errorCount: result.errors?.length ?? 0,
  })}`);
  return ctx.textResult(result);
};
