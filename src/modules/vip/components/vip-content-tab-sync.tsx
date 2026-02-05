import {
	__experimentalVStack as VStack,
	__experimentalText as Text,
	Notice,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { VipEnvironment } from '../types';

interface VipContentTabSyncProps {
	selectedEnvironment: VipEnvironment;
}

export function VipContentTabSync( { selectedEnvironment }: VipContentTabSyncProps ) {
	const { __ } = useI18n();
	const [ isSyncing, setIsSyncing ] = useState( false );
	const [ syncResult, setSyncResult ] = useState< { success: boolean; message: string } | null >(
		null
	);

	const handleSyncFromVip = async () => {
		setIsSyncing( true );
		setSyncResult( null );

		try {
			// The sync command requires the environment to be running
			if ( ! selectedEnvironment.running ) {
				setSyncResult( {
					success: false,
					message: __( 'Please start the environment before syncing.' ),
				} );
				setIsSyncing( false );
				return;
			}

			// Execute vip dev-env sync sql command
			const result = await getIpcApi().executeVipCliCommand( [
				'dev-env',
				'sync',
				'sql',
				`--slug=${ selectedEnvironment.slug }`,
				'--yes',
			] );

			if ( result.success ) {
				setSyncResult( {
					success: true,
					message: __( 'Database synced successfully from VIP Platform.' ),
				} );
			} else {
				setSyncResult( {
					success: false,
					message:
						result.stderr ||
						__(
							'Failed to sync database. Make sure you are logged in to VIP CLI and have access to the application.'
						),
				} );
			}
		} catch ( error ) {
			setSyncResult( {
				success: false,
				message: error instanceof Error ? error.message : __( 'An unexpected error occurred.' ),
			} );
		} finally {
			setIsSyncing( false );
		}
	};

	return (
		<div className="p-8 max-w-2xl">
			<VStack spacing={ 6 }>
				<div>
					<h2 className="a8c-subtitle-small mb-2">{ __( 'Sync from VIP Platform' ) }</h2>
					<Text className="text-a8c-gray-50">
						{ __(
							'Pull the database from your VIP Platform environment to this local environment. This will replace your local database with production data.'
						) }
					</Text>
				</div>

				{ syncResult && (
					<Notice
						status={ syncResult.success ? 'success' : 'error' }
						isDismissible={ true }
						onRemove={ () => setSyncResult( null ) }
					>
						{ syncResult.message }
					</Notice>
				) }

				<div className="bg-a8c-gray-0 rounded-lg p-4">
					<VStack spacing={ 4 }>
						<div>
							<Text className="font-medium">{ __( 'Database Sync' ) }</Text>
							<Text className="text-sm text-a8c-gray-50 mt-1">
								{ __(
									'Syncs the database from your connected VIP Platform environment. Requires VIP CLI authentication.'
								) }
							</Text>
						</div>

						<div className="flex items-center gap-4">
							<Button
								variant="primary"
								onClick={ handleSyncFromVip }
								disabled={ isSyncing || ! selectedEnvironment.running }
								isBusy={ isSyncing }
							>
								{ isSyncing ? __( 'Syncing…' ) : __( 'Sync Database' ) }
							</Button>

							{ ! selectedEnvironment.running && (
								<Text className="text-sm text-a8c-gray-50">
									{ __( 'Start the environment to enable sync.' ) }
								</Text>
							) }
						</div>
					</VStack>
				</div>

				<div className="border-t border-a8c-gray-5 pt-4">
					<Text className="text-xs text-a8c-gray-50">
						{ __(
							'Note: Make sure you are logged in to VIP CLI (run "vip login" in terminal) and have access to the VIP application you want to sync from.'
						) }
					</Text>
				</div>
			</VStack>
		</div>
	);
}
