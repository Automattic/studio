import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { ThemeProvider } from '@wordpress/theme';
import { VisuallyHidden } from '@wordpress/ui';
import { useState, type ReactElement } from 'react';
import * as Popover from '@/components/popover';
import { SiteList } from '@/components/site-list';
import styles from './style.module.css';

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 350;

export function CollapsedSiteSwitcher( {
	backgroundColor,
	trigger,
	onToggleSidebar,
}: {
	backgroundColor: string;
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
			<Popover.Popup
				side="top"
				align="start"
				sideOffset={ 8 }
				className={ styles.popup }
				style={ { backgroundColor } }
			>
				<VisuallyHidden render={ <Popover.Title /> }>{ __( 'Sites' ) }</VisuallyHidden>
				<ThemeProvider color={ { background: backgroundColor } }>
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
							<span className={ styles.shortcutKeys } aria-label={ `${ modifierAriaLabel } B` }>
								<kbd className={ styles.shortcutKey } aria-hidden="true">
									{ modifierKey }
								</kbd>
								<kbd className={ styles.shortcutKey } aria-hidden="true">
									B
								</kbd>
							</span>
						</button>
					</div>
				</ThemeProvider>
			</Popover.Popup>
		</Popover.Root>
	);
}
