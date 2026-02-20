import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { useProgress } from 'src/hooks/use-progress';
import { ProgressRow } from 'src/modules/preview-site/components/progress-row';

export const DeleteProgressRow = () => {
	const { __ } = useI18n();
	const { progress: deletionProgress, startProgress: startDeletionProgress } = useProgress( {
		step: 10,
	} );
	useEffect( () => {
		startDeletionProgress();
	}, [ startDeletionProgress ] );
	return <ProgressRow text={ __( 'Deleting preview site' ) } progress={ deletionProgress } />;
};
