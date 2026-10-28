import {
	getAiSkillCommands,
	getSlashCommandMatches,
	type SkillSlashCommand,
} from '@studio/agent/protocol/slash-commands';
import { useState } from 'react';
import { getCommandGroups } from '@/features/composer/composer-commands';
import { getActiveCommand } from '@/lib/ui';

// The sheet of commands and skills: the add button opens all of them, a
// `/fragment` in the draft its matches, until Escape dismisses that text.
export function useCommandSheet( {
	value,
	commands,
	isDisabled,
}: {
	value: string;
	commands: SkillSlashCommand[];
	isDisabled: ( name: string ) => boolean;
} ) {
	const [ addOpen, setAddOpen ] = useState( false );
	const [ dismissedText, setDismissedText ] = useState< string | null >( null );
	const [ highlight, setHighlight ] = useState< string >();
	const skills = getAiSkillCommands();
	const slash = getSlashCommandMatches( value, null, commands );
	const open = addOpen || ( slash.open && dismissedText !== value );
	const groups = getCommandGroups( {
		addOpen,
		commands,
		skills,
		matches: slash.matches,
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
