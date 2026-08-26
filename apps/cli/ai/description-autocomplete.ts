import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import { escapeRegex } from '@studio/common/lib/escape-regex';
import { theme } from 'cli/ai/theme';
import type { AutocompleteSuggestions } from '@earendil-works/pi-tui';
import type { SlashCommandDef } from 'cli/ai/slash-commands';

const highlightBlue = ( text: string ) => theme.fg( 'accent', text );

export function highlightMatch( text: string, query: string ): string {
	const index = text.toLowerCase().indexOf( query.toLowerCase() );
	if ( index === -1 ) {
		return text;
	}
	return (
		text.slice( 0, index ) +
		highlightBlue( text.slice( index, index + query.length ) ) +
		text.slice( index + query.length )
	);
}

// Matches one highlightMatch span. Built once from the codes the chalk
// wrapper actually emits; null when colors are off.
let highlightSpan: RegExp | null | undefined;
function getHighlightSpan(): RegExp | null {
	if ( highlightSpan === undefined ) {
		const [ open, close ] = highlightBlue( ' ' ).split( ' ' );
		highlightSpan = open
			? new RegExp( `(${ escapeRegex( open ) }.*?${ escapeRegex( close ) })` )
			: null;
	}
	return highlightSpan;
}

/**
 * Select-list `description` theme function: dims the text like `chalk.dim`,
 * but keeps `highlightMatch` spans at full intensity — wrapping the whole
 * string in `chalk.dim` would dim the highlight too.
 */
export function dimUnhighlighted( text: string ): string {
	const span = getHighlightSpan();
	if ( ! span ) {
		return theme.fg( 'muted', text );
	}
	// Captured highlight spans land at odd indices of split().
	return text
		.split( span )
		.map( ( part, i ) => ( i % 2 ? part : part && theme.fg( 'muted', part ) ) )
		.join( '' );
}

/**
 * Autocomplete provider that extends pi-tui's slash-command matching (command
 * names only) with a case-insensitive substring match against the commands'
 * descriptions, so e.g. `/migrate` surfaces the `liberate` command.
 * Description matches are appended after pi-tui's own name matches; selecting
 * one inserts the real command name (pi-tui's applyCompletion replaces the
 * whole typed `/token`).
 */
export class DescriptionAwareAutocompleteProvider extends CombinedAutocompleteProvider {
	private readonly slashCommands: SlashCommandDef[];

	constructor( commands: SlashCommandDef[], basePath: string ) {
		super( commands, basePath );
		this.slashCommands = commands;
	}

	override async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean }
	): Promise< AutocompleteSuggestions | null > {
		const suggestions = await super.getSuggestions( lines, cursorLine, cursorCol, options );

		// Mirror pi-tui's slash-command detection: a `/token` with no space yet.
		// Everything else (file paths, @-mentions, argument completion) passes
		// through untouched.
		const textBeforeCursor = ( lines[ cursorLine ] ?? '' ).slice( 0, cursorCol );
		if (
			options.force ||
			! textBeforeCursor.startsWith( '/' ) ||
			textBeforeCursor.includes( ' ' )
		) {
			return suggestions;
		}
		const query = textBeforeCursor.slice( 1 ).toLowerCase();
		if ( ! query ) {
			return suggestions;
		}

		const existing = new Set( ( suggestions?.items ?? [] ).map( ( item ) => item.value ) );
		const descriptionItems = this.slashCommands
			.filter(
				( command ) =>
					! existing.has( command.name ) && command.description.toLowerCase().includes( query )
			)
			.map( ( command ) => ( {
				value: command.name,
				label: command.name,
				description: command.description,
			} ) );
		if ( descriptionItems.length === 0 && ! suggestions ) {
			return null;
		}
		const items = [ ...( suggestions?.items ?? [] ), ...descriptionItems ].map( ( item ) => ( {
			...item,
			label: highlightMatch( item.label ?? item.value, query ),
			...( item.description && { description: highlightMatch( item.description, query ) } ),
		} ) );
		return {
			items,
			prefix: textBeforeCursor,
		};
	}
}
