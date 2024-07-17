import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { format } from 'date-fns';
import { sanitizeFolderName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import { ExportOptions } from '../lib/import-export/export/types';
import { BackupArchiveInfo } from '../lib/import-export/import/types';

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
			<ExportSite onExport={ getIpcApi().exportSite } selectedSite={ selectedSite }></ExportSite>
		</div>
	);
}
