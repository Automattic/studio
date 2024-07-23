import { speak } from '@wordpress/a11y';
import { Button as CoreButton } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf, __ } from '@wordpress/i18n';
import { Icon, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { format } from 'date-fns';
import { useRef } from 'react';
import { STUDIO_DOCS_URL } from '../constants';
import { useConfirmationDialog } from '../hooks/use-confirmation-dialog';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { sanitizeFolderName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import { ExportOptions } from '../lib/import-export/export/types';
import { ImportState } from '../lib/import-export/import/types';
import Button from './button';
import { ProgressBarWithAutoIncrement } from './progress-bar';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

const getFileName = ( selectedSite: SiteDetails ) => {
	const timestamp = format( new Date(), 'yyyy-MM-dd-HH-mm-ss' );
	return sanitizeFolderName( `studio-backup-${ selectedSite.name }-${ timestamp }` );
};

export const ExportSite = ( {
	selectedSite,
	onExport,
}: {
	selectedSite: SiteDetails;
	onExport: ( options: ExportOptions ) => Promise< void >;
} ) => {
	const onExportFullSite = async () => {
		const fileName = getFileName( selectedSite );
		const path = await getIpcApi().showSaveAsDialog( {
			title: __( 'Save backup file' ),
			defaultPath: `${ fileName }.tar.gz`,
			filters: [
				{
					name: 'Compressed Backup Files',
					extensions: [ 'tar.gz', 'tzg', 'zip' ],
				},
			],
		} );
		if ( ! path ) {
			return;
		}
		const options: ExportOptions = {
			sitePath: selectedSite.path,
			backupFile: path,
			includes: {
				database: true,
				uploads: true,
				plugins: true,
				themes: true,
			},
		};
		onExport( options );
	};

	const onExportDatabase = async () => {
		const fileName = getFileName( selectedSite );
		const path = await getIpcApi().showSaveAsDialog( {
			title: __( 'Save database file' ),
			defaultPath: `${ fileName }.sql`,
			filters: [
				{
					name: 'SQL dump file',
					extensions: [ 'sql' ],
				},
			],
		} );
		if ( ! path ) {
			return;
		}
		const options: ExportOptions = {
			sitePath: selectedSite.path,
			backupFile: path,
			includes: {
				database: true,
				uploads: false,
				plugins: false,
				themes: false,
			},
		};
		onExport( options );
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h4 className="a8c-subtitle-small leading-5">{ __( 'Export' ) }</h4>
				<p className="text-a8c-gray-70 leading-[140%] a8c-helper-text text-[13px]">
					{ __( 'Create a backup of your entire site or export the database.' ) }
				</p>
			</div>
			<div className="gap-4 flex flex-row">
				<CoreButton onClick={ onExportFullSite } variant="primary">
					{ __( 'Backup entire site' ) }
				</CoreButton>
				<CoreButton onClick={ onExportDatabase } type="submit" variant="secondary">
					{ __( 'Backup database' ) }
				</CoreButton>
			</div>
		</div>
	);
};

const InitialImportButton = ( {
	children,
	isInitial,
	openFileSelector,
}: {
	children: React.ReactNode;
	isInitial: boolean;
	openFileSelector: () => void;
} ) =>
	isInitial ? (
		<Button
			variant="icon"
			className="w-full [&>div.border-zinc-300]:hover:border-a8c-blueberry"
			onClick={ openFileSelector }
		>
			{ children }
		</Button>
	) : (
		<div className="w-full">{ children }</div>
	);

const ImportSite = ( props: { selectedSite: SiteDetails } ) => {
	const { __ } = useI18n();
	const { importFile, updateSite, startServer, loadingServer } = useSiteDetails();
	const importConfirmation = useConfirmationDialog( {
		message: sprintf( __( 'Overwrite %s?' ), props.selectedSite.name ),
		checkboxLabel: __( "Don't ask again" ),
		detail: __( 'Importing a backup will replace the existing files and database for your site.' ),
		confirmButtonLabel: __( 'Import' ),
		localStorageKey: 'dontShowImportConfirmation',
	} );

	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			importConfirmation( () => importFile( file, props.selectedSite ) );
		},
	} );
	const inputFileRef = useRef< HTMLInputElement >( null );
	const openFileSelector = async () => {
		inputFileRef.current?.click();
	};
	const onFileSelected = async ( e: React.ChangeEvent< HTMLInputElement > ) => {
		const file = e?.target?.files?.[ 0 ];
		if ( ! file ) {
			return;
		}
		importConfirmation( async () => {
			await importFile( file, props.selectedSite );
			clearImportFileInput();
		} );
	};
	const openSite = async () => {
		if ( ! props.selectedSite.running ) {
			speak( __( 'Starting the server before opening the site link' ) );
			await startServer( props.selectedSite.id );
		}
		getIpcApi().openSiteURL( props.selectedSite.id );
	};
	const clearImportFileInput = () => {
		if ( inputFileRef.current ) {
			inputFileRef.current.value = '';
		}
	};
	const clearImportState = () => {
		updateSite( { ...props.selectedSite, importState: ImportState.Initial } );
		clearImportFileInput();
	};

	const startLoadingCursorClassName =
		loadingServer[ props.selectedSite.id ] && 'animate-pulse duration-100 cursor-wait';

	const isImporting = props.selectedSite.importState === ImportState.Importing && ! isDraggingOver;
	const isImported = props.selectedSite.importState === ImportState.Imported && ! isDraggingOver;
	const isInitial = ! isImporting && ! isImported;
	return (
		<div className={ cx( 'flex flex-col w-full', startLoadingCursorClassName ) }>
			<div className="a8c-subtitle-small mb-1">{ __( 'Import' ) }</div>
			<div className="text-a8c-gray-70 a8c-body mb-4">
				{ createInterpolateElement(
					__( 'Import a Jetpack backup or a .sql database file. <button>Learn more</button>.' ),
					{
						button: (
							<Button variant="link" onClick={ () => getIpcApi().openURL( STUDIO_DOCS_URL ) } />
						),
					}
				) }
			</div>
			<div ref={ dropRef } className="w-full">
				<InitialImportButton isInitial={ isInitial } openFileSelector={ openFileSelector }>
					<div
						className={ cx(
							'h-48 w-full rounded-sm border border-zinc-300 flex-col justify-center items-center inline-flex',
							isDraggingOver && 'border-a8c-blueberry bg-a8c-gray-0'
						) }
					>
						{ isImporting && (
							<>
								<div className="w-[240px]">
									<ProgressBarWithAutoIncrement
										initialValue={ 50 }
										maxValue={ 95 }
										increment={ 5 }
									/>
								</div>
								<div className="text-a8c-gray-70 a8c-body mt-4">{ __( 'Importing backup…' ) }</div>
							</>
						) }
						{ isImported && (
							<>
								<span className="text-balck a8c-body">{ __( 'Import complete!' ) }</span>
								<div className="flex gap-2 mt-4">
									<Button
										className={ cx( startLoadingCursorClassName ) }
										variant="primary"
										onClick={ openSite }
									>
										{ __( 'Open site ↗' ) }
									</Button>
									<Button variant="link" className="!px-2.5 !py-2" onClick={ clearImportState }>
										{ __( 'Start again' ) }
									</Button>
								</div>
							</>
						) }
						{ isInitial && (
							<>
								<Icon className="fill-a8c-gray-70" icon={ download } />
								<span className="text-a8c-gray-70 a8c-body-small mt-1">
									{ isDraggingOver
										? __( 'Drop file' )
										: __( 'Drag a file here, or click to select a file' ) }
								</span>
							</>
						) }
					</div>
				</InitialImportButton>
			</div>
			<input
				ref={ inputFileRef }
				className="hidden"
				type="file"
				id="backup-file"
				accept=".zip,.sql,.tar,.gz"
				onChange={ onFileSelected }
			/>
		</div>
	);
};

export function ContentTabImportExport( { selectedSite }: ContentTabImportExportProps ) {
	return (
		<div className="flex flex-col p-8 gap-8">
			<ImportSite selectedSite={ selectedSite } />
			<ExportSite onExport={ getIpcApi().exportSite } selectedSite={ selectedSite }></ExportSite>
		</div>
	);
}
