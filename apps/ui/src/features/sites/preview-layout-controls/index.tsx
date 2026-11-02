import { __ } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { useConnector } from '@/data/core';
import { ChatIcon, GlobeIcon, SidebarIcon, SplitViewIcon } from '@/lib/icons';
import { IconButton, Menu, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';

export function PreviewLayoutControls( {
	open,
	onOpenChange,
	fullscreen,
	onFullscreenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	fullscreen: boolean;
	onFullscreenChange: ( fullscreen: boolean ) => void;
} ) {
	const hasShortcuts = Boolean( useConnector().onSetPreviewLayout );
	const layout = ! open ? 'chat' : fullscreen ? 'preview' : 'split';
	return (
		<Menu.Root modal={ false }>
			<Tooltip>
				<Menu.Trigger
					render={
						<TooltipTrigger
							render={
								<IconButton
									size="icon-sm"
									tooltip={ false }
									icon={ <SidebarIcon side="right" /> }
									label={ __( 'Preview layout' ) }
									data-preview-layout={ layout }
								/>
							}
						/>
					}
				/>
				<TooltipContent side="bottom">{ __( 'Change workspace layout' ) }</TooltipContent>
			</Tooltip>
			<Menu.Popup side="bottom" align="end">
				<Menu.RadioGroup
					value={ layout }
					onValueChange={ ( value ) => {
						if ( value === 'chat' ) onOpenChange( false );
						else onFullscreenChange( value === 'preview' );
					} }
				>
					<Menu.RadioItem
						value="chat"
						className={ hasShortcuts ? styles.itemWithShortcuts : undefined }
						aria-keyshortcuts={ hasShortcuts ? ariaKeyShortcut.primary( '1' ) : undefined }
					>
						<ChatIcon />
						{ __( 'Chat' ) }
						{ hasShortcuts ? (
							<Menu.Shortcut>{ displayShortcut.primary( '1' ) }</Menu.Shortcut>
						) : null }
						{ hasShortcuts && layout !== 'chat' ? (
							<span className={ styles.indicatorSpace } aria-hidden="true" />
						) : null }
					</Menu.RadioItem>
					<Menu.RadioItem
						value="split"
						className={ hasShortcuts ? styles.itemWithShortcuts : undefined }
						aria-keyshortcuts={ hasShortcuts ? ariaKeyShortcut.primary( '2' ) : undefined }
					>
						<SplitViewIcon />
						{ __( 'Split view' ) }
						{ hasShortcuts ? (
							<Menu.Shortcut>{ displayShortcut.primary( '2' ) }</Menu.Shortcut>
						) : null }
						{ hasShortcuts && layout !== 'split' ? (
							<span className={ styles.indicatorSpace } aria-hidden="true" />
						) : null }
					</Menu.RadioItem>
					<Menu.RadioItem
						value="preview"
						className={ hasShortcuts ? styles.itemWithShortcuts : undefined }
						aria-keyshortcuts={ hasShortcuts ? ariaKeyShortcut.primary( '3' ) : undefined }
					>
						<GlobeIcon />
						{ __( 'Browser' ) }
						{ hasShortcuts ? (
							<Menu.Shortcut>{ displayShortcut.primary( '3' ) }</Menu.Shortcut>
						) : null }
						{ hasShortcuts && layout !== 'preview' ? (
							<span className={ styles.indicatorSpace } aria-hidden="true" />
						) : null }
					</Menu.RadioItem>
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}
