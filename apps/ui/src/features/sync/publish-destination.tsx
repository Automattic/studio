import {
	getProviderDescriptor,
	getSitesDescriptor,
	SITES_PROVIDER_IDS,
	type SitesProviderId,
} from '@studio/providers';
import { useQueries } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import { Button } from '@/lib/ui';
import styles from './publish-destination.module.css';
import { PanelBody } from './publish-panel/parts';

// The providers a site can be published to here: one that publishes a static export needs the
// site to run on native PHP.
function usePublishProviders(): SitesProviderId[] {
	const connector = useConnector();
	return SITES_PROVIDER_IDS.filter(
		( id ) => connector.capabilities.nativeSites || ! getSitesDescriptor( id ).exportsStaticSite
	);
}

/**
 * Where the Publish tab publishes the site: the provider a request names, the one the user picked,
 * the only one there is, or the first one the site is connected to. Null while the user picks.
 */
export function usePublishDestination( siteId: string ) {
	const connector = useConnector();
	const providers = usePublishProviders();
	const connections = useQueries( {
		queries: providers.map( ( provider ) => ( {
			queryKey: remoteSitesQueryKey( provider, siteId ),
			queryFn: () => connector.getRemoteSites( provider, siteId ),
		} ) ),
	} );
	// Undefined until the user picks; null while they pick again.
	const [ chosen, setChosen ] = useState< SitesProviderId | null >();
	const connected = providers.find( ( _provider, index ) => connections[ index ]?.data?.length );
	const resolved = providers.length === 1 ? providers[ 0 ] : connected;
	// The destination stays put once found, so disconnecting its last site doesn't switch away.
	useEffect( () => {
		if ( chosen === undefined && resolved ) {
			setChosen( resolved );
		}
	}, [ chosen, resolved ] );
	const provider = chosen === null ? null : chosen ?? resolved ?? null;
	return {
		providers,
		provider,
		loading: chosen === undefined && connections.some( ( query ) => query.isPending ),
		// Undefined goes back to the default.
		choose: useCallback( ( next: SitesProviderId | undefined ) => setChosen( next ), [] ),
		change: useCallback( () => setChosen( null ), [] ),
	};
}

export function PublishDestinationLoading() {
	return <PanelBody insetTop loading />;
}

export function PublishDestinationPicker( {
	providers,
	onChoose,
}: {
	providers: SitesProviderId[];
	onChoose: ( provider: SitesProviderId ) => void;
} ) {
	return (
		<PanelBody insetTop>
			<h2 className={ styles.heading }>{ __( 'Where do you want to publish?' ) }</h2>
			<ul className={ styles.options }>
				{ providers.map( ( provider ) => {
					const { label } = getProviderDescriptor( provider );
					const { intro } = getSitesDescriptor( provider );
					return (
						<li key={ provider }>
							<Button
								variant="outline"
								size="lg"
								className={ styles.option }
								onClick={ () => onChoose( provider ) }
							>
								<span className={ styles.optionText }>
									<span className={ styles.optionLabel }>{ label }</span>
									<span className={ styles.optionDescription }>{ intro.description() }</span>
								</span>
								<ChevronRightIcon aria-hidden="true" />
							</Button>
						</li>
					);
				} ) }
			</ul>
		</PanelBody>
	);
}

export function PublishDestinationBar( {
	provider,
	onChange,
}: {
	provider: SitesProviderId;
	onChange: () => void;
} ) {
	const { label } = getProviderDescriptor( provider );
	return (
		<div className={ styles.bar }>
			<span className={ styles.barLabel }>
				{
					/* translators: %s: where the site is published, such as WordPress.com */
					sprintf( __( 'Publishing to %s' ), label )
				}
			</span>
			<Button variant="inline-accent" size="inline" onClick={ onChange }>
				{ __( 'Change' ) }
			</Button>
		</div>
	);
}
