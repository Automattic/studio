//
// Design Foundation schema
// ========================
// Single source of truth for the shape of design-foundation.json. Consumed by
// the three MCP tools (scaffold / validate / save), by the CLI subcommand,
// and by SP3's theme scaffolder.
//
// Two schemas are exported:
//   - DesignFoundationSchema — strict shape. The skill must produce this.
//   - PartialDesignFoundationSchema — relaxed: role slots may be null.
//     This is what liberate_design_foundation_scaffold returns.
//
// version 1 is the current contract. Bumps are breaking; see CHANGELOG if
// present. Consumers should pin to the version they were written against.
//
import { z } from 'zod';

export const RoleObj = z.object({
  value: z.string().min(1),
  role: z.string().min(1),
  evidence: z.array(z.string()).min(1),
});

const GradientObj = z.object({
  css: z.string().min(1),
  role: z.string().min(1),
  evidence: z.array(z.string()).min(1),
});

export type Role = z.infer<typeof RoleObj>;
export type Gradient = z.infer<typeof GradientObj>;

function buildSchema<R extends z.ZodTypeAny, G extends z.ZodTypeAny>(
  roleSchema: R,
  gradientSchema: G,
) {
  return z.object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    origin: z.string().url(),
    inputsDigest: z.object({
      palette: z.string().regex(/^sha256:/),
      typography: z.string().regex(/^sha256:/),
      breakpoints: z.string().regex(/^sha256:/),
      manifest: z.string().regex(/^sha256:/),
      // Optional for back-compat with foundations written before :root token
      // capture; the scaffold always emits it now.
      cssVariables: z.string().regex(/^sha256:/).optional(),
    }),
    color: z.object({
      surface: z.record(z.string(), roleSchema),
      text: z.record(z.string(), roleSchema),
      accent: z.record(z.string(), roleSchema),
      border: z.record(z.string(), roleSchema),
    }),
    gradient: z.record(z.string(), gradientSchema),
    typography: z.object({
      families: z.record(z.string(), roleSchema),
      scale: z.object({
        base: z.string(),
        steps: z.record(z.string(), z.string()),
        ratio: z.number().positive().optional(),
      }),
      weights: z.array(z.number().int().positive()),
    }),
    spacing: z.object({
      base: z.string(),
      scale: z.record(z.string(), z.string()),
      sections: z.object({
        padY: z.string(),
        padX: z.string(),
        contentMaxWidth: z.string(),
      }),
    }),
    breakpoints: z.object({
      sm: z.string().optional(),
      md: z.string().optional(),
      lg: z.string().optional(),
      xl: z.string().optional(),
      evidence: z.array(z.string()),
    }),
    radius: z.object({
      sm: z.string().optional(),
      base: z.string().optional(),
      lg: z.string().optional(),
      evidence: z.array(z.string()),
    }),
    components: z.record(
      z.string(),
      z.record(z.string(), z.union([z.string(), z.number()])),
    ),
    openQuestions: z.array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        blocksReplica: z.boolean(),
      }),
    ),
    // Dotted paths the skill must fill in a partial → full transition.
    // e.g. ["color.accent.primary", "typography.families.display"]
    skillTodos: z.array(z.string()),
  });
}

export const DesignFoundationSchema = buildSchema(RoleObj, GradientObj);

export const PartialDesignFoundationSchema = buildSchema(
  RoleObj.nullable(),
  GradientObj.nullable(),
);

export type DesignFoundation = z.infer<typeof DesignFoundationSchema>;
export type PartialDesignFoundation = z.infer<
  typeof PartialDesignFoundationSchema
>;
