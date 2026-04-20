import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { BackupFormat } from 'src/lib/import-export/import/preflight';

export type BackupPreflightState =
	| { status: 'idle' }
	| { status: 'checking' }
	| { status: 'valid'; format: BackupFormat; fileCount: number }
	| { status: 'invalid'; reason: string };

const IDLE: BackupPreflightState = { status: 'idle' };

export function useBackupPreflight( file: File | null ): BackupPreflightState {
	const [ state, setState ] = useState< BackupPreflightState >( IDLE );

	useEffect( () => {
		if ( ! file ) {
			setState( IDLE );
			return;
		}

		let cancelled = false;
		setState( { status: 'checking' } );

		void ( async () => {
			try {
				const filePath = getIpcApi().getPathForFile( file );
				const result = await getIpcApi().preflightBackup( filePath, file.type );
				if ( cancelled ) {
					return;
				}
				if ( result.valid ) {
					setState( {
						status: 'valid',
						format: result.format,
						fileCount: result.fileCount,
					} );
				} else {
					setState( { status: 'invalid', reason: result.reason } );
				}
			} catch ( err ) {
				if ( cancelled ) {
					return;
				}
				setState( {
					status: 'invalid',
					reason: err instanceof Error ? err.message : 'Preflight check failed.',
				} );
			}
		} )();

		return () => {
			cancelled = true;
		};
	}, [ file ] );

	return state;
}
