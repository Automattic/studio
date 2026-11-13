import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { ChevronDownIcon, EyeIcon, EyeOffIcon, ExternalLinkIcon } from '@/lib/icons';
import { Button, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type { useSiteVisibility } from '@/data/queries/use-site-visibility';
import type { SiteVisibility, ProviderSitesInfo } from '@studio/providers';

export function HostedAccessControl( {
	state,
	disabled,
	fallback,
	getOptions,
	managementLink,
}: {
	state: ReturnType< typeof useSiteVisibility >;
	disabled: boolean;
	fallback?: SiteVisibility;
	getOptions: NonNullable< ProviderSitesInfo[ 'visibilityOptions' ] >;
	managementLink?: { title: string; url: string };
} ) {
	const [ open, setOpen ] = useState( false );
	const connector = useConnector();
	const { query, save } = state;
	const value = query.isPending || query.isError ? undefined : query.data?.visibility ?? fallback;
	const VisibilityIcon = value === 'private' || value === 'coming-soon' ? EyeOffIcon : EyeIcon;
	const options = getOptions( value );
	const label = options.find( ( option ) => option.value === value )?.label ?? __( 'Unknown' );
	return (
		<div>
			<Menu.Root
				open={ open }
				onOpenChange={ ( next ) => {
					if ( ! save.isPending ) {
						setOpen( next );
						if ( next ) save.reset();
					}
				} }
			>
				<Menu.Trigger
					render={
						<Button
							variant="ghost"
							className={ styles.accessTrigger }
							disabled={ disabled }
							aria-label={ __( 'Who can view' ) }
							aria-description={ label }
						/>
					}
				>
					<VisibilityIcon data-icon="inline-start" />
					<span className={ styles.accessTriggerLabel }>{ __( 'Who can view' ) }</span>
					<span className={ styles.accessTriggerEnd } data-icon="inline-end">
						<span className={ styles.accessTriggerValue }>{ label }</span>
						<ChevronDownIcon data-dropdown-indicator />
					</span>
				</Menu.Trigger>
				<Menu.Popup side="bottom" align="end" aria-label={ __( 'Who can view' ) }>
					<Menu.RadioGroup
						value={ value ?? '' }
						onValueChange={ ( next ) => {
							if ( next === value || ! query.data || query.isError || save.isPending ) return;
							if (
								options.some( ( option ) => option.value === next && ! option.disabled ) &&
								( ! query.data.availableValues ||
									query.data.availableValues.includes( next as SiteVisibility ) )
							)
								save.mutate( next as SiteVisibility, { onSuccess: () => setOpen( false ) } );
						} }
					>
						{ options.map( ( option ) => (
							<Menu.RadioItem
								className={ styles.describedMenuItem }
								key={ option.value }
								value={ option.value }
								closeOnClick={ false }
								disabled={
									save.isPending ||
									! query.data ||
									query.isError ||
									option.disabled ||
									( query.data.availableValues &&
										! query.data.availableValues.includes( option.value ) )
								}
								aria-label={ option.label }
								aria-description={ option.description }
								onClick={ () => {
									if ( option.value === value ) setOpen( false );
								} }
							>
								<span className={ styles.accessChoiceText }>
									<span>{ option.label }</span>
									<span className={ styles.accessDescription }>{ option.description }</span>
								</span>
							</Menu.RadioItem>
						) ) }
					</Menu.RadioGroup>
					{ save.isError && (
						<p role="alert" className={ styles.accessPickerError }>
							{ save.error.message }
						</p>
					) }
					{ query.data?.message && (
						<p className={ styles.accessPickerError }>{ query.data.message }</p>
					) }
					{ managementLink && (
						<>
							<Menu.Separator />
							<Menu.Item
								disabled={ save.isPending }
								onClick={ () => void connector.openExternalUrl( managementLink.url ) }
							>
								{ managementLink.title }
								<ExternalLinkIcon data-icon="inline-end" />
							</Menu.Item>
						</>
					) }
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}
