import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { useProgressTimer } from '../hooks/use-progress-timer';
import ProgressBar from './progress-bar';

export function SiteLoadingIndicator() {
	const { __ } = useI18n();

	const { progress, setProgress } = useProgressTimer( {
		initialProgress: 5,
		interval: 1500,
		maxValue: 95,
	} );

	useEffect( () => {
		setProgress( 80 );
	}, [ setProgress ] );

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto justify-center items-center">
			<div className="w-[300px] text-center">
				<ProgressBar value={ progress } maxValue={ 100 } />
				<div className="text-a8c-gray-70 a8c-body mt-4">{ __( 'Creating site...' ) }</div>
			</div>
		</div>
	);
}
