import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { ExportOptions } from '../lib/import-export/export/types';
import { BackupArchiveInfo } from '../lib/import-export/import/types';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

export const ExportSite = ( {
	selectedSite,
	onExport,
}: {
	selectedSite: SiteDetails;
	onExport: ( options: ExportOptions ) => Promise< void >;
} ) => {
	const onExportFullSite = async () => {
		const path = await getIpcApi().showSaveAsDialog( {
			title: __( 'Save backup file' ),
			defaultPath: `${ selectedSite.name.split( ' ' ).join( '_' ).toLowerCase() }.tar.gz`,
			filters: [
				{
					name: '*.tar.gz, *.tzg *.zip',
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
		const path = await getIpcApi().showSaveAsDialog( {
			title: __( 'Save database file' ),
			defaultPath: `${ selectedSite.name.split( ' ' ).join( '_' ).toLowerCase() }.sql`,
			filters: [
				{
					name: '*.sql',
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
					{ __( 'Create a backup of your entire database.' ) }
				</p>
			</div>
			<div className="gap-4 flex flex-row">
				<Button onClick={ onExportFullSite } variant="primary">
					{ __( 'Backup entire site' ) }
				</Button>
				<Button onClick={ onExportDatabase } type="submit" variant="secondary">
					{ __( 'Backup database' ) }
				</Button>
			</div>
		</div>
	);
};

export function ContentTabImportExport( { selectedSite }: ContentTabImportExportProps ) {
	/* TODO: Remove before merge*/
	const [ file, setFile ] = useState< File | null >( null );

	/* TODO: Remove before merge*/
	const handleFileChange = ( e: React.ChangeEvent< HTMLInputElement > ) => {
		const selectedFile = e.target.files ? e.target.files[ 0 ] : null;
		if ( selectedFile ) {
			setFile( selectedFile );
		}
	};

	/* TODO: Remove handleImport before merge*/
	const handleImport = () => {
		if ( file ) {
			try {
				const backupFile: BackupArchiveInfo = {
					type: file.type,
					path: file.path,
				};
				getIpcApi().importSite( { id: selectedSite.id, backupFile } );
			} catch ( error ) {
				console.error( 'Error importing site:', error );
			}
		} else {
			console.warn( 'No file selected for import' );
		}
	};

	return (
		<div className="flex flex-col p-8 gap-8">
			{ /* TODO: Remove before div before merge*/ }
			<div>
				<h4 className="a8c-subtitle-small">{ __( 'Import' ) }</h4>
				<input type="file" onChange={ handleFileChange } />
				<button onClick={ handleImport }>Submit</button>
			</div>
			<ExportSite
				onExport={ async ( options ) => {
					await getIpcApi().exportSite( options );
				} }
				selectedSite={ selectedSite }
			></ExportSite>
		</div>
	);
}
