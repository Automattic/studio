import { GROUPS, getGroupLabel } from '@/features/commands/studio-commands';
import type { GroupId, PaletteCommand } from '@/features/commands/studio-commands';
import type { CommandGroup } from '@/lib/ui';

const byPriority = ( a: PaletteCommand, b: PaletteCommand ) =>
	( a.priority ?? 0 ) - ( b.priority ?? 0 );

const normalize = ( value: string ) => value.trim().toLocaleLowerCase().replace( /\s+/g, ' ' );

// Commands whose label or an alias contains every typed word rank above those
// matching only through keywords; groups are ordered by their best match.
export function matchCommands( commands: PaletteCommand[], query: string ) {
	const words = normalize( query ).split( ' ' ).filter( Boolean );
	if ( ! words.length ) {
		return commands
			.filter( ( command ) => ! command.searchOnly )
			.sort(
				( a, b ) => GROUPS.indexOf( a.group ) - GROUPS.indexOf( b.group ) || byPriority( a, b )
			);
	}
	const scored = commands
		.filter( ( command ) => ! command.browseOnly )
		.map( ( command ) => {
			const names = [ command.label, ...( command.aliases ?? [] ) ].map( normalize );
			const terms = [ ...names, ...( command.keywords ?? [] ).map( normalize ) ];
			const score = names.includes( words.join( ' ' ) )
				? 3
				: names.some( ( name ) => words.every( ( word ) => name.includes( word ) ) )
				? 2
				: words.every( ( word ) => terms.some( ( term ) => term.includes( word ) ) )
				? 1
				: 0;
			return { command, score };
		} )
		.filter( ( match ) => match.score > 0 );
	const best = new Map< GroupId, number >();
	for ( const { command, score } of scored ) {
		best.set( command.group, Math.max( best.get( command.group ) ?? 0, score ) );
	}
	return scored
		.sort(
			( a, b ) =>
				best.get( b.command.group )! - best.get( a.command.group )! ||
				GROUPS.indexOf( a.command.group ) - GROUPS.indexOf( b.command.group ) ||
				b.score - a.score ||
				byPriority( a.command, b.command )
		)
		.map( ( match ) => match.command );
}

// The matches as the list's groups, one per run of commands from the same group.
export function groupCommands( commands: PaletteCommand[] ): CommandGroup[] {
	const groups: CommandGroup[] = [];
	for ( const command of commands ) {
		const label = getGroupLabel( command.group );
		const item = {
			value: command.id,
			label: command.label,
			description: command.description,
			icon: command.icon,
		};
		const last = groups.at( -1 );
		if ( last?.label === label ) {
			last.items.push( item );
		} else {
			groups.push( {
				label,
				heading: label,
				items: [ item ],
			} );
		}
	}
	return groups;
}
