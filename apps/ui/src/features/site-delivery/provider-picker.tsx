import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@studio/ds';
import { getProvider, getProviderSites, type SitesProviderId } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { ConnectSiteIcon } from './connection-icons';
import { DestinationIcon } from './destination-icon';
import { ProviderLogo } from './provider-logo';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

const LAST_PROVIDER_KEY = 'studio-last-publish-provider';
export function rememberPublishProvider( provider: SitesProviderId ) {
	try {
		localStorage.setItem( LAST_PROVIDER_KEY, provider );
	} catch {
		/* Storage can be unavailable. */
	}
}
// The provider Publish opens on: the last one used, when connected, or else the first connected one
// that can start a site, rather than one that only connects sites the user already has.
export function defaultPublishProvider( connected: SitesProviderId[] ) {
	let last: string | null = null;
	try {
		last = localStorage.getItem( LAST_PROVIDER_KEY );
	} catch {
		/* Use descriptor order. */
	}
	return (
		connected.find( ( id ) => id === last ) ??
		connected.find( ( id ) => getProviderSites( id ).newSite )
	);
}
export function ProviderPicker( {
	providers,
	onSelect,
	onConnectExistingSite,
	disabled,
	selectedProvider,
	ref,
}: {
	providers: SitesProviderId[];
	onSelect: ( provider: SitesProviderId ) => void;
	onConnectExistingSite: () => void;
	disabled?: boolean;
	selectedProvider: SitesProviderId;
	ref?: ComponentProps< typeof SelectTrigger >[ 'ref' ];
} ) {
	const selected = getProvider( selectedProvider );
	const items = providers.map( ( value ) => ( {
		value,
		label: getProvider( value ).label,
		description: getProviderSites( value ).summary(),
	} ) );
	const existingSite = {
		value: 'existing-site',
		label: __( 'Connect to an existing site' ),
		description: __( 'Publish to a site you already have.' ),
	} as const;
	return (
		<Select< SitesProviderId | 'existing-site' >
			items={ [ ...items, existingSite ] }
			value={ selectedProvider }
			disabled={ disabled }
			onValueChange={ ( value ) => {
				if ( value === existingSite.value ) onConnectExistingSite();
				else if ( value ) onSelect( value );
			} }
		>
			<SelectTrigger
				ref={ ref }
				variant="ghost"
				fullWidth
				className={ styles.accessTrigger }
				aria-label={ __( 'Destination' ) }
				aria-description={ selected.label }
			>
				<span className={ styles.destinationRowIcon }>
					<DestinationIcon />
				</span>
				<span className={ styles.accessTriggerLabel }>{ __( 'Destination' ) }</span>
				<span className={ styles.accessTriggerEnd }>
					<SelectValue className={ styles.selectedProviderValue }>
						<ProviderLogo provider={ selectedProvider } compact />
						{ selected.label }
					</SelectValue>
				</span>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={ false }>
				{ items.map( ( { value, label, description } ) => (
					<SelectItem
						key={ value }
						value={ value }
						label={ label }
						icon={ <ProviderLogo provider={ value } compact /> }
						description={ description }
						aria-label={ label }
						aria-description={ description }
					>
						{ label }
					</SelectItem>
				) ) }
				<SelectGroup className={ styles.selectActions }>
					<SelectItem
						value={ existingSite.value }
						label={ existingSite.label }
						icon={ <ConnectSiteIcon /> }
						description={ existingSite.description }
						aria-label={ existingSite.label }
						aria-description={ existingSite.description }
					>
						{ existingSite.label }
					</SelectItem>
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
