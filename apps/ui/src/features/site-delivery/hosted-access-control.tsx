import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { ChevronDownIcon, EyeIcon, EyeOffIcon, ExternalLinkIcon } from '@/lib/icons';
import { Button, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type { useSiteVisibility } from '@/data/queries/use-site-visibility';
import type { SiteCreationVisibility, SiteVisibility, ProviderSitesInfo } from '@studio/providers';
import type { ReactNode } from 'react';

function AccessPicker( {
	value,
	options,
	disabled,
	restricted,
	valueLabel,
	open,
	onOpenChange,
	onValueChange,
	closeOnClick = true,
	children,
}: {
	value: string | undefined;
	options: { value: string; label: string; description: string; disabled?: boolean }[];
	disabled: boolean;
	restricted?: boolean;
	valueLabel?: string;
	open?: boolean;
	onOpenChange?: ( open: boolean ) => void;
	onValueChange: ( value: string ) => void;
	closeOnClick?: boolean;
	children?: ReactNode;
} ) {
	const VisibilityIcon = restricted ? EyeOffIcon : EyeIcon;
	const label =
		valueLabel ?? options.find( ( option ) => option.value === value )?.label ?? __( 'Unknown' );
	return (
		<div>
			<Menu.Root open={ open } onOpenChange={ onOpenChange }>
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
					<Menu.RadioGroup value={ value ?? '' } onValueChange={ onValueChange }>
						{ options.map( ( option ) => (
							<Menu.RadioItem
								className={ styles.describedMenuItem }
								key={ option.value }
								value={ option.value }
								closeOnClick={ closeOnClick }
								disabled={ option.disabled }
								aria-label={ option.label }
								aria-description={ option.description }
								onClick={ () => {
									if ( ! closeOnClick && option.value === value ) onOpenChange?.( false );
								} }
							>
								<span className={ styles.accessChoiceText }>
									<span>{ option.label }</span>
									<span className={ styles.accessDescription }>{ option.description }</span>
								</span>
							</Menu.RadioItem>
						) ) }
					</Menu.RadioGroup>
					{ children }
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}

export function PreviewAccessControl( {
	publicSelected,
	disabled,
	providerLabel,
	onPublicSelectedChange,
}: {
	publicSelected: boolean;
	disabled: boolean;
	providerLabel: string;
	onPublicSelectedChange: ( selected: boolean ) => void;
} ) {
	return (
		<AccessPicker
			value={ publicSelected ? 'public' : 'link' }
			options={ [
				{
					value: 'link',
					label: __( 'Anyone with the link' ),
					description: __( 'Share a temporary preview link' ),
				},
				{
					value: 'public',
					label: __( 'Everyone' ),
					description: sprintf(
						/* translators: %s: hosting provider name. */
						__( 'Finish publishing on %s' ),
						providerLabel
					),
				},
			] }
			disabled={ disabled }
			onValueChange={ ( next ) => onPublicSelectedChange( next === 'public' ) }
		/>
	);
}

export function SiteCreationAccessControl( {
	value,
	policy,
	loading,
	disabled,
	getOptions,
	onChange,
}: {
	value?: SiteCreationVisibility;
	policy?: SiteCreationVisibility;
	loading: boolean;
	disabled: boolean;
	getOptions: NonNullable< ProviderSitesInfo[ 'visibilityOptions' ] >;
	onChange: ( value: SiteCreationVisibility ) => void;
} ) {
	return (
		<AccessPicker
			value={ value }
			valueLabel={ loading ? __( 'Checking…' ) : undefined }
			options={ getOptions( value )
				.filter( ( option ) => option.value === 'private' || option.value === 'public' )
				.map( ( option ) => ( {
					...option,
					disabled: option.disabled || ( policy === 'private' && option.value === 'public' ),
				} ) ) }
			disabled={ disabled }
			restricted={ value === 'private' }
			onValueChange={ ( next ) => {
				if ( next === 'private' || ( next === 'public' && policy === 'public' ) ) onChange( next );
			} }
		>
			{ policy === 'private' && (
				<p className={ styles.accessPickerError }>
					{ __( 'Your team only allows restricted sites.' ) }
				</p>
			) }
		</AccessPicker>
	);
}

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
	const options = getOptions( value ).map( ( option ) => ( {
		...option,
		disabled:
			save.isPending ||
			! query.data ||
			query.isError ||
			option.disabled ||
			( query.data.availableValues && ! query.data.availableValues.includes( option.value ) ),
	} ) );
	return (
		<AccessPicker
			value={ value }
			options={ options }
			disabled={ disabled }
			restricted={ value === 'private' || value === 'coming-soon' }
			open={ open }
			closeOnClick={ false }
			onOpenChange={ ( next ) => {
				if ( ! save.isPending ) {
					setOpen( next );
					if ( next ) save.reset();
				}
			} }
			onValueChange={ ( next ) => {
				const option = options.find( ( option ) => option.value === next && ! option.disabled );
				if ( option && next !== value )
					save.mutate( option.value, { onSuccess: () => setOpen( false ) } );
			} }
		>
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
		</AccessPicker>
	);
}
