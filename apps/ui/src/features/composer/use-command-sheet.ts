import {
	getAiSkillCommands,
	getSlashCommandMatches,
	type SkillSlashCommand,
} from '@studio/agent/protocol/slash-commands';
import { getActiveCommand } from '@studio/ds';
import { useState } from 'react';
import { getCommandGroups } from '@/features/composer/composer-commands';

// The sheet of commands and skills: the add button opens suggestions, a
// `/fragment` in the draft its matches, until Escape dismisses that text.
export function useCommandSheet( {
	value,
	commands,
	userSkills: ownSkills = [],
	isDisabled,
}: {
	value: string;
	commands: SkillSlashCommand[];
	// The user's own skills, for the site and for all sites. They show ahead of Studio's.
	userSkills?: SkillSlashCommand[];
	isDisabled: ( name: string ) => boolean;
} ) {
	const [ addOpen, setAddOpen ] = useState( false );
	const [ dismissedText, setDismissedText ] = useState< string | null >( null );
	const [ highlight, setHighlight ] = useState< string >();
	// Studio's names are reserved: a skill of the user's with one of them never loads.
	const userSkills = ownSkills.filter(
		( skill ) =>
			! [ ...commands, ...getAiSkillCommands() ].some( ( command ) => command.name === skill.name )
	);
	const skills = [
		...userSkills,
		...getAiSkillCommands().filter(
			( skill ) => ! commands.some( ( command ) => command.name === skill.name )
		),
	];
	const slash = getSlashCommandMatches( value, null, [ ...commands, ...userSkills ] );
	const open = addOpen || ( slash.open && dismissedText !== value );
	const groups = getCommandGroups( {
		addOpen,
		commands,
		skills,
		userSkills,
		matches: slash.matches.filter(
			( match ) =>
				! commands.some( ( command ) => command.name === match.name && command !== match )
		),
		searching: ! addOpen && slash.open && ! value.endsWith( '/' ),
		isDisabled,
	} );

	return {
		open,
		addOpen,
		skills,
		groups,
		highlight,
		setHighlight,
		activeCommand: open ? getActiveCommand( groups, highlight ) : undefined,
		close() {
			setAddOpen( false );
			setDismissedText( value );
		},
		onOpenChange( next: boolean, details: { reason: string } ) {
			if ( details.reason === 'trigger-press' && ! addOpen ) {
				setAddOpen( true );
				return;
			}
			setAddOpen( next );
			if ( ! next ) {
				setDismissedText( value );
			}
		},
		onDraftChange() {
			setDismissedText( null );
			setHighlight( undefined );
		},
	};
}
