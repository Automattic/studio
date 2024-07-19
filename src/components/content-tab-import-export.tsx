import { createInterpolateElement } from '@wordpress/element';
import { Icon, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useRef } from 'react';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { ImportState } from '../lib/import-export/import/types';
import Button from './button';
import { ProgressBarWithAutoIncrement } from './progress-bar';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

export function ContentTabImportExport( props: ContentTabImportExportProps ) {
	const { __ } = useI18n();
	const { importFile, updateSite, startServer } = useSiteDetails();
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			importFile( file, props.selectedSite );
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
		importFile( file, props.selectedSite );
	};
	const openSite = async () => {
		if ( ! props.selectedSite.running ) {
			await startServer( props.selectedSite.id );
		}
		getIpcApi().openSiteURL( props.selectedSite.id );
	};
	const clearImportState = () =>
		updateSite( { ...props.selectedSite, importState: ImportState.Initial } );
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
				{ props.selectedSite.importState === ImportState.Importing && (
					<div className="h-48 w-full rounded-sm border border-zinc-300 flex-col justify-center items-center inline-flex">
						<div className="w-[240px]">
							<ProgressBarWithAutoIncrement initialValue={ 50 } maxValue={ 95 } increment={ 5 } />
						</div>
						<div className="text-a8c-gray-70 a8c-body mt-4">{ __( 'Importing backup…' ) }</div>
					</div>
				) }
				{ props.selectedSite.importState === ImportState.Imported && (
					<div className="h-48 w-full rounded-sm border border-zinc-300 flex-col justify-center items-center inline-flex">
						<span className="text-balck a8c-body">{ __( 'Import complete!' ) }</span>
						<div className="flex gap-2 mt-4">
							<Button variant="primary" onClick={ openSite }>
								{ __( 'Open site' ) }
							</Button>
							<Button variant="link" className="!px-2.5 !py-2" onClick={ clearImportState }>
								{ __( 'Start again' ) }
							</Button>
						</div>
					</div>
				) }
				{ ! props.selectedSite.importState && (
					<div ref={ dropRef } className="w-full">
						<Button variant="icon" className="w-full" onClick={ openFileSelector }>
							<div
								className={ cx(
									'h-48 w-full rounded-sm border border-zinc-300 hover:border-a8c-blueberry flex-col justify-center items-center inline-flex',
									isDraggingOver && 'border-a8c-blueberry bg-a8c-gray-0'
								) }
							>
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
				<input
					ref={ inputFileRef }
					className="hidden"
					type="file"
					id="backup-file"
					accept=".zip,.sql,.tar,.gz"
					onChange={ onFileSelected }
				/>
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
