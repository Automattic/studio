import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { getIpcApi } from '../lib/get-ipc-api';
import { ExportOptions } from '../lib/import-export/export/types';

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
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for backup' ) );
		if ( ! response?.path ) {
			return;
		}
		const options: ExportOptions = {
			sitePath: selectedSite.path,
			backupPath: response.path,
			includes: {
				database: true,
				uploads: true,
				plugins: true,
				themes: true,
			},
		};
		onExport( options );
		console.log( options );
	};

	const onExportDatabase = async () => {
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for backup' ) );
		if ( ! response?.path ) {
			return;
		}
		const options: ExportOptions = {
			sitePath: selectedSite.path,
			backupPath: response?.path,
			includes: {
				database: true,
				uploads: false,
				plugins: false,
				themes: false,
			},
		};
		onExport( options );
		console.log( options );
	};

	return (
		<div className="flex flex-col">
			<h4 className="a8c-subtitle-small">{ __( 'Export' ) }</h4>
			<p className="text-a8c-gray-70 text-body-small leading-[140%]">
				{ __( 'Create a backup of your entire database.' ) }
			</p>
			<div className="mt-4 flex flex-row gap-5">
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
	return (
		<div className="flex flex-col p-8">
			<ExportSite
				onExport={ async ( options ) => {
					await getIpcApi().exportSite( options );
				} }
				selectedSite={ selectedSite }
			></ExportSite>
		</div>
	);
}
