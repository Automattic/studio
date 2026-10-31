import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import {
	getDirectionalHistoryEntries,
	getHistoryEntryPath,
	type BrowserNavigationState,
} from '@/features/sites/site-preview/browser-state';
import { ArrowLeftIcon, ArrowRightIcon } from '@/lib/icons';
import { IconButton, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type { NavigationShortcut } from '@/features/sites/site-preview/browser-shortcuts';

export function BrowserHistoryButton( {
	direction,
	browserState,
	shortcut,
	disabled: disabledByHost,
	onStep,
	onJump,
}: {
	direction: 'back' | 'forward';
	browserState: BrowserNavigationState;
	disabled: boolean;
	shortcut: NavigationShortcut;
	onStep: () => void;
	onJump: ( index: number ) => void;
} ) {
	const entries = getDirectionalHistoryEntries(
		browserState.historyEntries,
		browserState.activeHistoryIndex,
		direction
	);
	const back = direction === 'back';
	const label = back ? __( 'Back' ) : __( 'Forward' );
	const disabled =
		disabledByHost || ( back ? ! browserState.canGoBack : ! browserState.canGoForward );
	const [ menuOpen, setMenuOpen ] = useState( false );
	const trigger = (
		<IconButton
			size="icon-sm"
			icon={ back ? <ArrowLeftIcon /> : <ArrowRightIcon /> }
			label={ label }
			shortcut={ shortcut }
			tooltip={ ! disabled }
			tooltipSide="bottom"
			disabled={ disabled }
			disabledAppearance="icon"
			onClick={ onStep }
			onContextMenu={ ( event ) => {
				event.preventDefault();
				if ( ! disabled ) {
					setMenuOpen( true );
				}
			} }
		/>
	);

	return (
		<Menu.Root
			open={ menuOpen }
			onOpenChange={ ( open ) => {
				if ( ! open ) {
					setMenuOpen( false );
				}
			} }
		>
			<Menu.Trigger render={ trigger } />
			<Menu.Popup side="bottom" align="start">
				{ entries.length ? (
					entries.map( ( entry ) => (
						<Menu.Item
							key={ `${ entry.index }:${ entry.url }` }
							onClick={ () => onJump( entry.index ) }
						>
							<span className={ styles.historyEntry }>
								<span className={ styles.historyTitle }>
									{ entry.title || getHistoryEntryPath( entry.url ) }
								</span>
								<span className={ styles.historyPath }>{ getHistoryEntryPath( entry.url ) }</span>
							</span>
						</Menu.Item>
					) )
				) : (
					<Menu.Item disabled>
						{ back ? __( 'No back history' ) : __( 'No forward history' ) }
					</Menu.Item>
				) }
			</Menu.Popup>
		</Menu.Root>
	);
}
