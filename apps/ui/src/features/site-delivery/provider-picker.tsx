import { getProvider, getProviderSites, type SitesProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/lib/ui';
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
export function orderedPublishProviders( providers: SitesProviderId[] ) {
	let last: string | null = null;
	try {
		last = localStorage.getItem( LAST_PROVIDER_KEY );
	} catch {
		/* Use descriptor order. */
	}
	return [ ...providers ].sort( ( a, b ) => Number( b === last ) - Number( a === last ) );
}
export function ProviderPicker( {
	providers,
	connectedProviders,
	onSelect,
	onConnectExistingSite,
	disabled,
	selectedProvider,
	ref,
}: {
	providers: SitesProviderId[];
	connectedProviders: SitesProviderId[];
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
		description: connectedProviders.includes( value )
			? getProviderSites( value ).publishing.description()
			: sprintf(
					/* translators: %s: description of the hosting provider. */
					__( '%s · Connect' ),
					getProviderSites( value ).publishing.description()
			  ),
	} ) );
	const existingSite = {
		value: 'existing-site',
		label: __( 'Connect to an existing site' ),
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
					>
						{ existingSite.label }
					</SelectItem>
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
