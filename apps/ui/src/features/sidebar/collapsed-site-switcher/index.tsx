import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { useState, type ReactElement } from 'react';
import { SiteList } from '@/features/sidebar/site-list';
import { Kbd, KbdGroup, Popover, VisuallyHidden } from '@/lib/ui';
import styles from './style.module.css';

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 350;

export function CollapsedSiteSwitcher( {
	trigger,
	onToggleSidebar,
}: {
	trigger: ReactElement< Record< string, unknown > >;
	onToggleSidebar: () => void;
} ) {
	const [ open, setOpen ] = useState( false );
	const isApple = isAppleOS();
	const modifierKey = isApple ? '⌘' : 'Ctrl';
	const modifierAriaLabel = isApple ? __( 'Command' ) : __( 'Control' );

	return (
		<Popover.Root open={ open } onOpenChange={ setOpen }>
			<Popover.Trigger
				openOnHover
				delay={ HOVER_OPEN_DELAY_MS }
				closeDelay={ HOVER_CLOSE_DELAY_MS }
				render={ trigger }
			/>
			<Popover.Popup side="bottom" align="start" sideOffset={ 8 } className={ styles.popup }>
				<Popover.Title render={ <VisuallyHidden /> }>{ __( 'Sites' ) }</Popover.Title>
				<div className={ styles.surface }>
					<div className={ styles.scrollArea }>
						<SiteList
							className={ styles.siteList }
							reorderable={ false }
							onSiteOpen={ () => setOpen( false ) }
						/>
					</div>
					<button type="button" className={ styles.openSidebarCta } onClick={ onToggleSidebar }>
						<span>{ __( 'Open sidebar' ) }</span>
						<KbdGroup aria-label={ `${ modifierAriaLabel } B` }>
							<Kbd aria-hidden="true">{ modifierKey }</Kbd>
							<Kbd aria-hidden="true">B</Kbd>
						</KbdGroup>
					</button>
				</div>
			</Popover.Popup>
		</Popover.Root>
	);
}
