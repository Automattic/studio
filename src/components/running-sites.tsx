import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import Button from './button';

export function RunningSites() {
	const { __, _n } = useI18n();
	const { data, stopAllRunningSites } = useSiteDetails();

	const runningSites = data.filter( ( site ) => site.running );

	return (
		<>
			{ runningSites.length > 0 && (
				<div className="flex flex-row px-5 pb-1 justify-between align-center self-stretch opacity-70">
					<p className="text-xxs leading-4">
						{ sprintf(
							_n( '%d site running', '%d sites running', runningSites.length ),
							runningSites.length
						) }
					</p>
					<Button
						disabled={ runningSites.length === 0 }
						className={ cx(
							'[&.is-link]:text-white [&.is-link:disabled]:hover:text-white [&.is-link:not(:disabled)]:hover:text-a8c-gray-10 [&.is-link]:text-right text-xxs leading-4 !mb-0 items-start'
						) }
						onClick={ stopAllRunningSites }
						variant="link"
					>
						{ __( 'Stop all' ) }
					</Button>
				</div>
			) }
		</>
	);
}
