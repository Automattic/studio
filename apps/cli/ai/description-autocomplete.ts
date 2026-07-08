import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import type { AutocompleteSuggestions } from '@earendil-works/pi-tui';
import type { SlashCommandDef } from 'cli/ai/slash-commands';

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
		if ( descriptionItems.length === 0 ) {
			return suggestions;
		}
		return {
			items: [ ...( suggestions?.items ?? [] ), ...descriptionItems ],
			prefix: textBeforeCursor,
		};
	}
}
