import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';

const linkButtonClassName = cx(
	'[&.is-link]:text-white [&.is-link:disabled]:hover:text-white [&.is-link:not(:disabled)]:hover:text-a8c-gray-10 [&.is-link]:text-right text-xxs leading-4 !mb-0 items-start'
);

export function RunningSites() {
	const { __, _n } = useI18n();
	const { sites, stopAllRunningSites, startAllStoppedSites, loadingServer } = useSiteDetails();

	const runningSites = sites.filter( ( site ) => site.running );
	const realSites = sites.filter( ( site ) => ! site.isAddingSite );
	const hasLoadingSites = Object.values( loadingServer ).some( Boolean );
	const anyRunning = runningSites.length > 0;

	if ( realSites.length === 0 ) {
		return null;
	}

	return (
		<div className="flex flex-row px-5 pb-1 justify-between align-center self-stretch opacity-70">
			<p className="text-xxs leading-4">
				{ anyRunning
					? sprintf(
							_n( '%d site running', '%d sites running', runningSites.length ),
							runningSites.length
					  )
					: __( 'No sites running' ) }
			</p>
			{ anyRunning ? (
				<Button className={ linkButtonClassName } onClick={ stopAllRunningSites } variant="link">
					{ runningSites.length === 1 ? __( 'Stop' ) : __( 'Stop all' ) }
				</Button>
			) : (
				<Button
					disabled={ hasLoadingSites }
					className={ linkButtonClassName }
					onClick={ startAllStoppedSites }
					variant="link"
				>
					{ realSites.length === 1 ? __( 'Start' ) : __( 'Start all' ) }
				</Button>
			) }
		</div>
	);
}
