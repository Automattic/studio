import { __ } from '@wordpress/i18n';
import { SearchIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { groupCommands, matchCommands } from '@/features/commands/command-search';
import { PreviewParticles } from '@/features/sites';
import { isImeComposing } from '@/lib/keyboard';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	Dialog,
	DialogContent,
	DialogDescription,
	CommandList,
	VisuallyHidden,
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
	const [ executing, setExecuting ] = useState( false );
	const [ poetry, setPoetry ] = useState( false );
	const listId = useId();
	const matches = matchCommands( commands, query );
	const groups = groupCommands( matches );
	const active = getActiveCommand( groups, highlight );
	const run = ( id: string ) => {
		setExecuting( true );
		onOpenChange( false );
		matches.find( ( command ) => command.id === id )?.run();
	};

	return (
		<Dialog
			open={ open }
			onOpenChange={ onOpenChange }
			onOpenChangeComplete={ ( isOpen ) => {
				if ( ! isOpen ) {
					setQuery( '' );
					setExecuting( false );
					setPoetry( false );
					setHighlight( undefined );
				}
			} }
		>
			<DialogContent
				className={ poetry ? styles.poetryPopup : styles.popup }
				data-poetry={ poetry ? '' : undefined }
				data-instant={ executing && ! open ? '' : undefined }
				aria-label={ poetry ? __( 'Code is poetry' ) : __( 'Command palette' ) }
				onKeyDownCapture={ ( event ) => {
					if ( ! poetry || event.key === 'Tab' ) return;
					event.stopPropagation();
					if ( isImeComposing( event ) || event.repeat ) {
						event.preventDefault();
						return;
					}
					if ( event.key === 'Escape' ) {
						event.preventDefault();
						onOpenChange( false );
					} else if ( event.key !== 'Enter' && event.key !== ' ' ) {
						event.preventDefault();
					}
				} }
				onKeyUpCapture={ ( event ) => {
					if ( poetry ) event.stopPropagation();
				} }
			>
				{ poetry ? (
					<PoetryView onClose={ () => onOpenChange( false ) } />
				) : (
					<>
						<InputGroup variant="commands">
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
								onKeyDown={ ( event ) => {
									if (
										event.key === 'Enter' &&
										query.trim().replace( /\s+/g, ' ' ).toLowerCase() === 'code is poetry'
									) {
										if ( isImeComposing( event ) || event.repeat ) return;
										event.preventDefault();
										event.stopPropagation();
										setPoetry( true );
										return;
									}
									handleCommandKey( event, groups, active?.value, setHighlight, run );
								} }
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
					</>
				) }
			</DialogContent>
		</Dialog>
	);
}

function PoetryView( { onClose }: { onClose: () => void } ) {
	const dismissRef = useRef< HTMLButtonElement >( null );
	useEffect( () => dismissRef.current?.focus(), [] );

	return (
		<>
			<DialogDescription render={ <VisuallyHidden /> }>
				{ __( 'Click anywhere or press Escape to return to Studio.' ) }
			</DialogDescription>
			<button
				ref={ dismissRef }
				type="button"
				className={ styles.poetryScene }
				aria-label={ __( 'Return to Studio' ) }
				onClick={ onClose }
			>
				<PreviewParticles active showLogo />
			</button>
		</>
	);
}
