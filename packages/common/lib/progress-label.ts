import { __, sprintf } from '@wordpress/i18n';

// Progress labels are rewritten in place as an operation ticks — in the CLI's
// spinner line, and in the agentic UI's per-site activity row. Leading with the
// percentage keeps the number in the same spot as the label around it changes
// length, and zero-padding single digits stops the text shifting on every
// update. `formatProgressLabel( 'Creating remote backup…', 3 )` → `03% ·
// Creating remote backup…`.
export function formatProgressLabel( label: string, percent: number ): string {
	return sprintf(
		/* translators: %1$s: percentage complete, zero-padded to two digits. %2$s: what is in progress. */
		__( '%1$s%% · %2$s' ),
		String( Math.round( percent ) ).padStart( 2, '0' ),
		label
	);
}
