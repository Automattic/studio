import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';

export function RunningSites() {
	const { __, _n } = useI18n();
	const { data, stopAllRunningSites } = useSiteDetails();

	const runningSites = data.filter( ( site ) => site.running );

	return (
		<div className="flex flex-row px-5 pt-4 justify-between align-center self-stretch opacity-70">
			<p className="text-xxs leading-4">
				{ sprintf(
					_n( '%d site running', '%d sites running', runningSites.length ),
					runningSites.length
				) }
			</p>
			<button
				disabled={ runningSites.length === 0 }
				className={ cx(
					'text-white text-xxs leading-4 !mb-0',
					runningSites.length === 0 && 'cursor-not-allowed !mb-0'
				) }
				onClick={ stopAllRunningSites }
			>
				{ __( 'Stop all' ) }
			</button>
		</div>
	);
}
