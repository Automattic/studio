import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { __ } from '@wordpress/i18n';
import { download, upload } from '@wordpress/icons';
import { Field } from '@wordpress/ui';
import { useEffect, useMemo, useState } from 'react';
import { useConnector } from '@/data/core';
import { useDeskSettings, useUpdateDeskSettings } from '@/data/queries/use-desk-config';
import { useSites } from '@/data/queries/use-sites';
import {
	Button,
	Dialog,
	DialogCloseButton,
	DialogContent,
	DialogError,
	DialogFooter,
	DialogHeader,
	DialogTip,
	DialogTitle,
} from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './style.module.css';
import type { DeskConfig } from '@/ui-desks/desk/types';

interface DeskSettingsModalProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onEditToolbar: () => void;
}

export function DeskSettingsModal( { open, onOpenChange, onEditToolbar }: DeskSettingsModalProps ) {
	const connector = useConnector();
	const desk = useDesk();
	const { data: sites } = useSites();
	const { data: savedDeskSettings } = useDeskSettings();
	const fallbackDeskSettings = useMemo( () => createDefaultDeskSettings(), [] );
	const settings = savedDeskSettings ?? fallbackDeskSettings;
	const updateDeskSettings = useUpdateDeskSettings();
	const [ status, setStatus ] = useState< { tone: 'success' | 'error'; message: string } | null >(
		null
	);
	const [ isExporting, setIsExporting ] = useState( false );
	const [ isImporting, setIsImporting ] = useState( false );
	const activeSiteName = sites?.find( ( site ) => site.id === desk.siteId )?.name;
	const isDeskDataActionDisabled =
		desk.isReadOnly || desk.isLoading || ! desk.canAddWidgets || isExporting || isImporting;

	useEffect( () => {
		if ( ! open ) {
			setStatus( null );
		}
	}, [ open ] );

	const exportDesk = async () => {
		const deskConfig = desk.getDeskConfigSnapshot();
		if ( ! deskConfig ) {
			setStatus( { tone: 'error', message: __( 'Could not export desk.' ) } );
			return;
		}

		setStatus( null );
		setIsExporting( true );
		try {
			const exportedPath = await connector.exportDeskConfig(
				deskConfig,
				getDeskExportFilename( activeSiteName )
			);
			if ( exportedPath ) {
				setStatus( { tone: 'success', message: __( 'Desk exported.' ) } );
			}
		} catch ( error ) {
			console.warn( 'Failed to export desk.', error );
			setStatus( { tone: 'error', message: __( 'Could not export desk.' ) } );
		} finally {
			setIsExporting( false );
		}
	};

	const importDesk = async () => {
		setStatus( null );
		setIsImporting( true );
		try {
			const deskConfig = await connector.importDeskConfig();
			if ( ! deskConfig ) {
				return;
			}

			if (
				! window.confirm(
					__( 'Replace the current desk with the imported file? This cannot be undone.' )
				)
			) {
				return;
			}

			const didImport = await desk.replaceDeskConfig( deskConfig as DeskConfig );
			setStatus(
				didImport
					? { tone: 'success', message: __( 'Desk imported.' ) }
					: { tone: 'error', message: __( 'Could not import desk.' ) }
			);
		} catch ( error ) {
			console.warn( 'Failed to import desk.', error );
			setStatus( { tone: 'error', message: __( 'Could not import desk.' ) } );
		} finally {
			setIsImporting( false );
		}
	};

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
				<div className={ styles.settingsSection }>
					<div className={ styles.settingsSectionTitle }>{ __( 'Desk data' ) }</div>
					<div className={ styles.settingsActions }>
						<Button
							type="button"
							icon={ download }
							label={ __( 'Export desk' ) }
							variant="quiet"
							size="medium"
							disabled={ isDeskDataActionDisabled }
							onClick={ () => void exportDesk() }
						>
							{ isExporting ? __( 'Exporting...' ) : __( 'Export desk' ) }
						</Button>
						<Button
							type="button"
							icon={ upload }
							label={ __( 'Import desk' ) }
							variant="quiet"
							size="medium"
							disabled={ isDeskDataActionDisabled }
							onClick={ () => void importDesk() }
						>
							{ isImporting ? __( 'Importing...' ) : __( 'Import desk' ) }
						</Button>
					</div>
					{ status?.tone === 'error' && <DialogError>{ status.message }</DialogError> }
					{ status?.tone === 'success' && <DialogTip>{ status.message }</DialogTip> }
				</div>
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

function getDeskExportFilename( siteName?: string ) {
	const stamp = new Date().toISOString().slice( 0, 10 );
	const name = sanitizeFolderName( siteName ? `studio-desk-${ siteName }` : 'studio-desk-user' );
	return `${ name || 'studio-desk' }-${ stamp }.json`;
}
