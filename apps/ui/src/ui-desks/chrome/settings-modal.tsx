import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { DeskSettings } from '@/data/core';

interface DeskSettingsModalProps {
	settings: DeskSettings;
	onChange: ( patch: Partial< DeskSettings > ) => void;
	onClose: () => void;
	onEditToolbar: () => void;
}

export function DeskSettingsModal( {
	settings,
	onChange,
	onClose,
	onEditToolbar,
}: DeskSettingsModalProps ) {
	return (
		<div className={ styles.settingsBackdrop } onClick={ onClose }>
			<div
				className={ styles.settingsModal }
				role="dialog"
				aria-label={ __( 'Desk settings' ) }
				onClick={ ( event ) => event.stopPropagation() }
			>
				<header className={ styles.settingsHeader }>
					<h2>{ __( 'Settings' ) }</h2>
					<button
						type="button"
						className={ styles.settingsCloseButton }
						onClick={ onClose }
						aria-label={ __( 'Close settings' ) }
					>
						<Icon icon={ close } size={ 20 } />
					</button>
				</header>
				<div className={ styles.settingsBody }>
					<label className={ styles.settingsToggleRow }>
						<input
							type="checkbox"
							checked={ settings.showSiteName }
							onChange={ ( event ) => onChange( { showSiteName: event.target.checked } ) }
						/>
						<span>{ __( 'Show site name' ) }</span>
					</label>
				</div>
				<footer className={ styles.settingsFooter }>
					<button
						type="button"
						className={ clsx( styles.settingsFooterButton, styles.settingsFooterButtonPrimary ) }
						onClick={ () => {
							onClose();
							onEditToolbar();
						} }
					>
						{ __( 'Edit toolbar' ) }
					</button>
				</footer>
			</div>
		</div>
	);
}
