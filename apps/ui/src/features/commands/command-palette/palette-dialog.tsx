import { __ } from '@wordpress/i18n';
import { SearchIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { groupCommands, matchCommands } from '@/features/commands/command-search';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	Dialog,
	DialogContent,
	CommandList,
	getActiveCommand,
	handleCommandKey,
} from '@/lib/ui';
import styles from './style.module.css';
import type { PaletteCommand } from '@/features/commands/studio-commands';

export type PaletteProps = {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	commands: PaletteCommand[];
};

export function PaletteDialog( { open, onOpenChange, commands }: PaletteProps ) {
	const [ query, setQuery ] = useState( '' );
	const [ highlight, setHighlight ] = useState< string >();
	const listId = useId();
	const matches = matchCommands( commands, query );
	const groups = groupCommands( matches );
	const active = getActiveCommand( groups, highlight );
	const run = ( id: string ) => {
		onOpenChange( false );
		matches.find( ( command ) => command.id === id )?.run();
	};

	return (
		<Dialog
			open={ open }
			onOpenChange={ onOpenChange }
			onOpenChangeComplete={ ( isOpen ) => ! isOpen && setQuery( '' ) }
		>
			<DialogContent
				backdrop="transparent"
				className={ styles.popup }
				aria-label={ __( 'Command palette' ) }
			>
				<InputGroup>
					<InputGroupInput
						role="combobox"
						aria-autocomplete="list"
						aria-expanded
						aria-controls={ listId }
						aria-activedescendant={ active ? `${ listId }-${ active.value }` : undefined }
						placeholder={ __( 'Search commands' ) }
						aria-label={ __( 'Search commands' ) }
						value={ query }
						onChange={ ( event ) => {
							setQuery( event.target.value );
							setHighlight( undefined );
						} }
						onKeyDown={ ( event ) =>
							handleCommandKey( event, groups, active?.value, setHighlight, run )
						}
					/>
					<InputGroupAddon>
						<SearchIcon className={ styles.icon } />
					</InputGroupAddon>
				</InputGroup>
				<CommandList
					id={ listId }
					label={ __( 'Commands' ) }
					size="default"
					groups={ groups }
					highlighted={ active?.value }
					onHighlight={ setHighlight }
					onSelect={ run }
					empty={ __( 'No commands found.' ) }
				/>
			</DialogContent>
		</Dialog>
	);
}
