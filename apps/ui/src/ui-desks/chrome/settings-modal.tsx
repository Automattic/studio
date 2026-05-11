import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { __ } from '@wordpress/i18n';
import { Dialog, Field } from '@wordpress/ui';
import { useMemo } from 'react';
import { useDeskSettings, useUpdateDeskSettings } from '@/data/queries/use-desk-config';
import { ActionButton } from '@/ui-desks/components';
import styles from './style.module.css';

interface DeskSettingsModalProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onEditToolbar: () => void;
}

export function DeskSettingsModal( { open, onOpenChange, onEditToolbar }: DeskSettingsModalProps ) {
	const { data: savedDeskSettings } = useDeskSettings();
	const fallbackDeskSettings = useMemo( () => createDefaultDeskSettings(), [] );
	const settings = savedDeskSettings ?? fallbackDeskSettings;
	const updateDeskSettings = useUpdateDeskSettings();

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small" className={ styles.settingsDialog }>
				<Dialog.Header className={ styles.settingsHeader }>
					<Dialog.Title>{ __( 'Settings' ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content className={ styles.settingsBody }>
					<Field.Root className={ styles.settingsToggleRow } render={ <div /> }>
						<Field.Control
							type="checkbox"
							checked={ settings.showSiteName }
							onChange={ ( event ) => updateDeskSettings( { showSiteName: event.target.checked } ) }
						/>
						<Field.Label variant="plain">{ __( 'Show site name' ) }</Field.Label>
					</Field.Root>
				</Dialog.Content>
				<Dialog.Footer className={ styles.settingsFooter }>
					<ActionButton
						type="button"
						className={ styles.settingsPrimaryAction }
						onClick={ () => {
							onOpenChange( false );
							onEditToolbar();
						} }
					>
						{ __( 'Edit toolbar' ) }
					</ActionButton>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
