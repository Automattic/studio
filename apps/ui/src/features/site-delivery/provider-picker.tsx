import { getProviderDescriptor, getSitesDescriptor, type SitesProviderId } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { ChevronDownIcon, MapPinIcon, PlusIcon } from '@/lib/icons';
import { Button, Menu } from '@/lib/ui';
import { ProviderLogo } from './provider-logo';
import styles from './style.module.css';

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
	onSelect,
	onConnectProviders,
	disabled,
	selectedProvider,
}: {
	providers: SitesProviderId[];
	onSelect: ( provider: SitesProviderId ) => void;
	onConnectProviders?: () => void;
	disabled?: boolean;
	selectedProvider: SitesProviderId;
} ) {
	const [ open, setOpen ] = useState( false );
	const selected = getProviderDescriptor( selectedProvider );
	const providerValue = (
		<span className={ styles.destinationProviderValue }>
			<ProviderLogo provider={ selectedProvider } branded compact />
			{ selected.label }
		</span>
	);
	if ( providers.length < 2 && ! onConnectProviders )
		return (
			<div className={ styles.staticInfo }>
				<MapPinIcon data-icon="inline-start" />
				<span className={ styles.accessTriggerLabel }>{ __( 'Destination' ) }</span>
				{ providerValue }
			</div>
		);
	return (
		<Menu.Root open={ open } onOpenChange={ setOpen }>
			<Menu.Trigger
				render={
					<Button
						variant="ghost"
						className={ styles.providerPickerTrigger }
						disabled={ disabled }
						aria-label={ __( 'Destination' ) }
						aria-description={ selected.label }
					/>
				}
			>
				<MapPinIcon data-icon="inline-start" />
				<span className={ styles.accessTriggerLabel }>{ __( 'Destination' ) }</span>
				<span className={ styles.accessTriggerEnd } data-icon="inline-end">
					{ providerValue }
					<ChevronDownIcon data-dropdown-indicator />
				</span>
			</Menu.Trigger>
			<Menu.Popup
				side="bottom"
				sideOffset={ 2 }
				align="center"
				className={ styles.providerPickerMenu }
				aria-label={ __( 'Where to publish' ) }
			>
				<Menu.RadioGroup value={ selectedProvider }>
					{ providers.map( ( provider ) => {
						const descriptor = getProviderDescriptor( provider );
						const { publishing } = getSitesDescriptor( provider );
						return (
							<Menu.RadioItem
								className={ styles.providerMenuItem }
								data-address-theme={ publishing.addressTheme }
								key={ provider }
								value={ provider }
								onClick={ () => onSelect( provider ) }
							>
								<ProviderLogo provider={ provider } branded compact />
								<span className={ styles.accessChoiceText }>
									<span>{ descriptor.label }</span>
									<span className={ styles.accessDescription }>{ publishing.description() }</span>
								</span>
							</Menu.RadioItem>
						);
					} ) }
				</Menu.RadioGroup>
				{ onConnectProviders && (
					<>
						<Menu.Separator />
						<Menu.Item onClick={ onConnectProviders }>
							<PlusIcon />
							{ __( 'Connect more providers' ) }
						</Menu.Item>
					</>
				) }
			</Menu.Popup>
		</Menu.Root>
	);
}
