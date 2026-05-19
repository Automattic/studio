import { useCallback } from 'react';
import { type ImportSource } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';

interface UseImportBackupDeeplinkOptions {
	isAnySiteProcessing: boolean;
	setFileForImport: ( file: ImportSource | null ) => void;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
	onModalOpen?: () => void;
}

/**
 * Listens for the `import-backup-from-deeplink` IPC event emitted by the
 * `wp-studio://import-backup?url=…` deeplink handler. When triggered, it loads
 * the already-downloaded backup file reference into the Add Site form and
 * routes the modal to the backup create step.
 */
export function useImportBackupDeeplink( options: UseImportBackupDeeplinkOptions ): void {
	const { isAnySiteProcessing, setFileForImport, setIsDeeplinkFlow, onModalOpen } = options;

	useIpcListener(
		'import-backup-from-deeplink',
		useCallback(
			(
				_event: unknown,
				{
					backupPath,
					fileName,
					fileSize,
				}: {
					backupPath: string;
					fileName: string;
					fileSize: number;
				}
			) => {
				if ( isAnySiteProcessing ) {
					return;
				}

				setFileForImport( {
					path: backupPath,
					name: fileName,
					size: fileSize,
				} );
				setIsDeeplinkFlow( true );
				onModalOpen?.();
			},
			[ isAnySiteProcessing, setFileForImport, setIsDeeplinkFlow, onModalOpen ]
		)
	);
}
