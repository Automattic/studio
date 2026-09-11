import { wrapTextWithAnsi, type SelectItem } from '@earendil-works/pi-tui';
import { theme } from 'cli/ai/theme';

export const OTHER_VALUE = '__other__';
const MIN_DESCRIPTION_WIDTH = 10;

/**
 * Multi-line option rows for AskUserQuestion: full label with the wrapped
 * description indented below — no truncation, newlines preserved. Passing
 * `checked` renders multi-select checkboxes.
 */
export function buildOptionPickerLines(
	items: SelectItem[],
	selectedValue: string | undefined,
	width: number,
	checked?: Set< string >
): string[] {
	// Aligns descriptions under the numbered labels ("→ 1. " / "→ [x] 1. ").
	const descriptionIndent = ' '.repeat( checked ? 9 : 5 );
	const descriptionWidth = Math.max( MIN_DESCRIPTION_WIDTH, width - descriptionIndent.length - 2 );
	const lines: string[] = [];

	for ( const item of items ) {
		const isSelected = item.value === selectedValue;
		const checkbox =
			! checked || item.value === OTHER_VALUE ? '' : checked.has( item.value ) ? '[x] ' : '[ ] ';
		item.label.split( '\n' ).forEach( ( labelLine, index ) => {
			const marker = index === 0 && isSelected ? '→ ' : '  ';
			const line = marker + ( index === 0 ? checkbox : ' '.repeat( checkbox.length ) ) + labelLine;
			lines.push( isSelected ? theme.fg( 'accent', line ) : line );
		} );
		if ( item.description ) {
			for ( const descriptionLine of wrapTextWithAnsi( item.description, descriptionWidth ) ) {
				lines.push( theme.fg( 'muted', descriptionIndent + descriptionLine ) );
			}
		}
	}
	return lines;
}
