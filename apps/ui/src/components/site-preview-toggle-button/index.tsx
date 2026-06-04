import { __ } from '@wordpress/i18n';
import { navigation } from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { createPortal } from 'react-dom';
import styles from './style.module.css';

interface KeyboardShortcutDescriptor {
	displayShortcut: string;
	ariaKeyShortcut: string;
}

interface SitePreviewToggleButtonProps {
	previewOpen: boolean;
	onTogglePreview: () => void;
	shortcut: KeyboardShortcutDescriptor;
}

export function SitePreviewToggleButton( {
	previewOpen,
	onTogglePreview,
	shortcut,
}: SitePreviewToggleButtonProps ) {
	const label = previewOpen ? __( 'Hide Explorer' ) : __( 'Show Explorer' );

	const button = (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							size="small"
							aria-label={ label }
							aria-keyshortcuts={ shortcut.ariaKeyShortcut }
							aria-pressed={ previewOpen }
							onClick={ onTogglePreview }
						/>
					}
					className={ styles.toggle }
				>
					<Icon icon={ navigation } size={ 16 } />
					<span>{ __( 'Explorer' ) }</span>
				</Tooltip.Trigger>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
					{ label } <span aria-hidden="true">{ shortcut.displayShortcut }</span>
				</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);

	if ( typeof document === 'undefined' ) {
		return button;
	}

	return createPortal( button, document.body );
}
