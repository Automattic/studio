import { createInterpolateElement } from '@wordpress/element';
import { Icon, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ProgressBarWithAutoIncrement } from './progress-bar';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

export function ContentTabImportExport( props: ContentTabImportExportProps ) {
	const { __ } = useI18n();
	const { importFile } = useSiteDetails();
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			importFile( file, props.selectedSite );
		},
	} );
	return (
		<div className="p-8 flex flex-col justify-between gap-8">
			<div className="flex flex-col w-full">
				<div className="a8c-subtitle-small mb-1">{ __( 'Import' ) }</div>
				<div className="text-a8c-gray-70 a8c-body mb-4">
					{ createInterpolateElement(
						__( 'Import a Jetpack backup or a .sql database file. <a>Learn more.</a>' ),
						{
							a: (
								<Button
									variant="link"
									onClick={ () =>
										getIpcApi().openURL(
											'https://developer.wordpress.com/docs/developer-tools/studio/'
										)
									}
								/>
							),
						}
					) }
				</div>
				{ props.selectedSite.isImporting ? (
					<div className="h-48 w-full rounded-sm border border-zinc-300 flex-col justify-center items-center inline-flex">
						<div className="w-[240px]">
							<ProgressBarWithAutoIncrement initialValue={ 50 } maxValue={ 95 } increment={ 5 } />
						</div>
						<div className="text-a8c-gray-70 a8c-body mt-4">{ __( 'Importing backup…' ) }</div>
					</div>
				) : (
					<div ref={ dropRef } className="w-full">
						<Button variant="icon" className="w-full">
							<div className="h-48 w-full rounded-sm border border-zinc-300 flex-col justify-center items-center inline-flex">
								<Icon className="fill-a8c-gray-70" icon={ download } />
								<span className="text-a8c-gray-70 a8c-body-small mt-1">
									{ isDraggingOver
										? __( 'Drop file' )
										: __( 'Drag a file here, or click to select a file' ) }
								</span>
							</div>
						</Button>
					</div>
				) }
			</div>
			<div className="flex flex-col w-full">
				<div className="a8c-subtitle-small mb-1">{ __( 'Export' ) }</div>
				<div className="text-a8c-gray-70 a8c-body mb-4">
					{ __( 'Create a backup of your entire site or export the database.' ) }
				</div>
			</div>
		</div>
	);
}
