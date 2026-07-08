import { wrapTextWithAnsi, type SelectItem } from '@earendil-works/pi-tui';
import chalk from '@studio/common/lib/chalk';

const DESCRIPTION_INDENT = '     '; // aligns descriptions under the numbered labels ("→ 1. ")
const MIN_DESCRIPTION_WIDTH = 10;

/**
 * Render AskUserQuestion options as multi-line rows: the full label, then the
 * description word-wrapped and indented beneath it. Unlike SelectList's
 * built-in single-row layout, nothing is truncated, and embedded newlines in
 * labels and descriptions are preserved.
 */
export function buildOptionPickerLines(
	items: SelectItem[],
	selectedValue: string | undefined,
	width: number
): string[] {
	const descriptionWidth = Math.max( MIN_DESCRIPTION_WIDTH, width - DESCRIPTION_INDENT.length - 2 );
	const lines: string[] = [];

	for ( const item of items ) {
		const isSelected = item.value === selectedValue;
		item.label.split( '\n' ).forEach( ( labelLine, index ) => {
			const marker = index === 0 && isSelected ? '→ ' : '  ';
			lines.push( isSelected ? chalk.blue( marker + labelLine ) : marker + labelLine );
		} );
		if ( item.description ) {
			for ( const descriptionLine of wrapTextWithAnsi( item.description, descriptionWidth ) ) {
				lines.push( chalk.dim( DESCRIPTION_INDENT + descriptionLine ) );
			}
		}
	}
	return lines;
}
