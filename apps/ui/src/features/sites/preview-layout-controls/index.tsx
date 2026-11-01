import { __ } from '@wordpress/i18n';
import { ChatIcon, GlobeIcon, SidebarIcon } from '@/lib/icons';
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
									className={ styles.trigger }
									icon={ <SidebarIcon side="right" /> }
									label={ __( 'Preview layout' ) }
									data-preview-layout={ layout }
								/>
							}
						/>
					}
				/>
				<TooltipContent side="bottom">{ __( 'Preview layout' ) }</TooltipContent>
			</Tooltip>
			<Menu.Popup side="bottom" align="end">
				<Menu.RadioGroup
					value={ layout }
					onValueChange={ ( value ) => {
						if ( value === 'chat' ) onOpenChange( false );
						else onFullscreenChange( value === 'preview' );
					} }
				>
					<Menu.RadioItem value="chat">
						<ChatIcon />
						{ __( 'Chat' ) }
					</Menu.RadioItem>
					<Menu.RadioItem value="split">
						<SidebarIcon side="right" />
						{ __( 'Split view' ) }
					</Menu.RadioItem>
					<Menu.RadioItem value="preview">
						<GlobeIcon />
						{ __( 'Browser' ) }
					</Menu.RadioItem>
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}
