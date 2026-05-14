import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { __ } from '@wordpress/i18n';
import { Field } from '@wordpress/ui';
import { useMemo } from 'react';
import { useDeskSettings, useUpdateDeskSettings } from '@/data/queries/use-desk-config';
import {
	Button,
	Dialog,
	DialogCloseButton,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/ui-desks/components';
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
		<Dialog
			ariaLabel={ __( 'Settings' ) }
			gap="compact"
			onClose={ () => onOpenChange( false ) }
			open={ open }
			size="small"
		>
			<DialogHeader>
				<DialogTitle>{ __( 'Settings' ) }</DialogTitle>
				<DialogCloseButton onClose={ () => onOpenChange( false ) } />
			</DialogHeader>
			<DialogContent>
				<Field.Root className={ styles.settingsToggleRow } render={ <div /> }>
					<Field.Control
						type="checkbox"
						checked={ settings.showSiteName }
						onChange={ ( event ) => updateDeskSettings( { showSiteName: event.target.checked } ) }
					/>
					<Field.Label variant="plain">{ __( 'Show site name' ) }</Field.Label>
				</Field.Root>
			</DialogContent>
			<DialogFooter>
				<Button
					type="button"
					label={ __( 'Edit toolbar' ) }
					tone="inverse"
					variant="filled"
					size="medium"
					onClick={ () => {
						onOpenChange( false );
						onEditToolbar();
					} }
				>
					{ __( 'Edit toolbar' ) }
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
