import {
	__experimentalVStack as VStack,
	__experimentalText as Text,
	Notice,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getVipIpcApi } from './vip-ipc';
import type { VipEnvironment } from '../types';

interface VipContentTabImportExportProps {
	selectedEnvironment: VipEnvironment;
}

export function VipContentTabImportExport( {
	selectedEnvironment,
}: VipContentTabImportExportProps ) {
	const { __ } = useI18n();
	const [ isImporting, setIsImporting ] = useState( false );
	const [ importResult, setImportResult ] = useState< {
		success: boolean;
		message: string;
	} | null >( null );

	const handleImportSql = async () => {
		setIsImporting( true );
		setImportResult( null );

		try {
			if ( ! selectedEnvironment.running ) {
				setImportResult( {
					success: false,
					message: __( 'Please start the environment before importing.' ),
				} );
				setIsImporting( false );
				return;
			}

			const result = await getIpcApi().showOpenFolderDialog(
				__( 'Select SQL file to import' ),
				selectedEnvironment.path
			);

			if ( ! result?.path ) {
				setIsImporting( false );
				return;
			}

			const importResult = await getVipIpcApi().vipExecuteVipCliCommand( [
				'dev-env',
				'import',
				'sql',
				result.path,
				`--slug=${ selectedEnvironment.slug }`,
				'--yes',
			] );

			if ( importResult.success ) {
				setImportResult( { success: true, message: __( 'SQL file imported successfully.' ) } );
			} else {
				setImportResult( {
					success: false,
					message: importResult.stderr || __( 'Failed to import SQL file.' ),
				} );
			}
		} catch ( error ) {
			setImportResult( {
				success: false,
				message: error instanceof Error ? error.message : __( 'An unexpected error occurred.' ),
			} );
		} finally {
			setIsImporting( false );
		}
	};

	const handleImportMedia = async () => {
		setIsImporting( true );
		setImportResult( null );

		try {
			if ( ! selectedEnvironment.running ) {
				setImportResult( {
					success: false,
					message: __( 'Please start the environment before importing.' ),
				} );
				setIsImporting( false );
				return;
			}

			const result = await getIpcApi().showOpenFolderDialog(
				__( 'Select media folder to import' ),
				selectedEnvironment.path
			);

			if ( ! result?.path ) {
				setIsImporting( false );
				return;
			}

			const importResult = await getVipIpcApi().vipExecuteVipCliCommand( [
				'dev-env',
				'import',
				'media',
				result.path,
				`--slug=${ selectedEnvironment.slug }`,
				'--yes',
			] );

			if ( importResult.success ) {
				setImportResult( { success: true, message: __( 'Media files imported successfully.' ) } );
			} else {
				setImportResult( {
					success: false,
					message: importResult.stderr || __( 'Failed to import media files.' ),
				} );
			}
		} catch ( error ) {
			setImportResult( {
				success: false,
				message: error instanceof Error ? error.message : __( 'An unexpected error occurred.' ),
			} );
		} finally {
			setIsImporting( false );
		}
	};

	return (
		<div className="p-8 max-w-2xl">
			<VStack spacing={ 6 }>
				<div>
					<h2 className="a8c-subtitle-small mb-2">{ __( 'Import & Export' ) }</h2>
					<Text className="text-a8c-gray-50">
						{ __( 'Import database or media files to your local VIP environment.' ) }
					</Text>
				</div>

				{ importResult && (
					<Notice
						status={ importResult.success ? 'success' : 'error' }
						isDismissible={ true }
						onRemove={ () => setImportResult( null ) }
					>
						{ importResult.message }
					</Notice>
				) }

				<div className="bg-a8c-gray-0 rounded-lg p-4">
					<VStack spacing={ 4 }>
						<div>
							<Text className="font-medium">{ __( 'Import SQL Database' ) }</Text>
							<Text className="text-sm text-a8c-gray-50 mt-1">
								{ __(
									'Import a SQL file to replace the database in your local environment. This will overwrite existing data.'
								) }
							</Text>
						</div>

						<div className="flex items-center gap-4">
							<Button
								variant="secondary"
								onClick={ () => {
									void handleImportSql();
								} }
								disabled={ isImporting || ! selectedEnvironment.running }
								isBusy={ isImporting }
							>
								{ __( 'Select SQL File…' ) }
							</Button>

							{ ! selectedEnvironment.running && (
								<Text className="text-sm text-a8c-gray-50">
									{ __( 'Start the environment to enable import.' ) }
								</Text>
							) }
						</div>
					</VStack>
				</div>

				<div className="bg-a8c-gray-0 rounded-lg p-4">
					<VStack spacing={ 4 }>
						<div>
							<Text className="font-medium">{ __( 'Import Media Files' ) }</Text>
							<Text className="text-sm text-a8c-gray-50 mt-1">
								{ __(
									'Import media files (images, documents, etc.) to the wp-content/uploads directory of your local environment.'
								) }
							</Text>
						</div>

						<div className="flex items-center gap-4">
							<Button
								variant="secondary"
								onClick={ () => {
									void handleImportMedia();
								} }
								disabled={ isImporting || ! selectedEnvironment.running }
								isBusy={ isImporting }
							>
								{ __( 'Select Media Folder…' ) }
							</Button>
						</div>
					</VStack>
				</div>

				<div className="border-t border-a8c-gray-5 pt-4">
					<Text className="text-xs text-a8c-gray-50">
						{ __(
							'Tip: You can also use the VIP CLI directly for more advanced import options. Run "vip dev-env import --help" in your terminal.'
						) }
					</Text>
				</div>
			</VStack>
		</div>
	);
}
