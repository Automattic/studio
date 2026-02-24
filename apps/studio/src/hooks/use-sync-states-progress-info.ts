import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';

export type PullStateProgressInfo = {
	key: 'in-progress' | 'downloading' | 'importing' | 'finished' | 'failed' | 'cancelled';
	progress: number;
	message: string;
};
export type PushStateProgressInfo = {
	key:
		| 'creatingBackup'
		| 'uploading'
		| 'creatingRemoteBackup'
		| 'applyingChanges'
		| 'finishing'
		| 'finished'
		| 'failed'
		| 'cancelled'
		| 'uploadingPaused'
		| 'uploadingManuallyPaused';
	progress: number;
	message: string;
};

function getPushUploadPercentage(
	statusKey: PushStateProgressInfo[ 'key' ] | undefined,
	uploadProgress: number | undefined
): number | null {
	if ( statusKey === 'uploading' && uploadProgress !== undefined ) {
		return Math.round( uploadProgress );
	}
	return null;
}

export function useSyncStatesProgressInfo() {
	const { __ } = useI18n();

	const uploadingProgressMessageTemplate = useMemo( () => __( 'Uploading site (%d%%)…' ), [ __ ] );

	const getPushUploadMessage = useCallback(
		( message: string, uploadPercentage: number | null ): string => {
			if ( uploadPercentage !== null ) {
				// translators: %d is the upload progress percentage
				return sprintf( uploadingProgressMessageTemplate, uploadPercentage );
			}
			return message;
		},
		[ uploadingProgressMessageTemplate ]
	);

	return {
		getPushUploadPercentage,
		getPushUploadMessage,
	};
}
