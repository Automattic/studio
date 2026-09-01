import { __ } from '@wordpress/i18n';
import { isAppleOS } from '@wordpress/keycodes';
import { privateApis } from '@wordpress/theme';
import { Popover, VisuallyHidden } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { SiteList } from '@/components/site-list';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';

const { ThemeProvider } = unlock( privateApis );

// A short pause before opening so incidental pointer travel across the
// toggle doesn't flash the list, and a longer grace period before closing
// so brief hover gaps don't dismiss it.
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
				variant="unstyled"
				className={ clsx( styles.popup, motionStyles.motion ) }
				positioner={
					<Popover.Positioner
						side="top"
						align="start"
						sideOffset={ 8 }
						className={ styles.positioner }
					/>
				}
			>
				<VisuallyHidden render={ <Popover.Title /> }>{ __( 'Sites' ) }</VisuallyHidden>
				{ /* Same dark theme scope as the expanded sidebar so the list
				     renders identically on the window-chrome background. */ }
				<ThemeProvider color={ { background: backgroundColor } }>
					<div className={ styles.surface } style={ { backgroundColor } }>
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
