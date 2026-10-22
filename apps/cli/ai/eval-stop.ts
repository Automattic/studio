import { z } from 'zod';

// A tool call that ends an eval run: the tool's name and, optionally, a regex
// for each input field to match. Cases that judge what the agent did before
// starting the work (for example, which skills it loaded) stop there instead
// of paying for the work itself.
export const stopRuleSchema = z.object( {
	tool: z.string(),
	input: z.record( z.string(), z.string() ).optional(),
} );
export type StopRule = z.infer< typeof stopRuleSchema >;

function fieldText( value: unknown ): string {
	return typeof value === 'string' ? value : JSON.stringify( value ) ?? '';
}

export function matchesStopRule(
	call: { name: string; input: unknown },
	rules: StopRule[]
): boolean {
	const input = ( call.input ?? {} ) as Record< string, unknown >;
	return rules.some(
		( rule ) =>
			rule.tool === call.name &&
			Object.entries( rule.input ?? {} ).every( ( [ field, pattern ] ) =>
				new RegExp( pattern ).test( fieldText( input[ field ] ) )
			)
	);
}
