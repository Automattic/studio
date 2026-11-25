import { __ } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { PickerRow, type PickerOption } from './select-row';
import styles from './style.module.css';
import { VisibilityIcon, type AccessValue } from './visibility-icon';
import type { useSiteVisibility } from '@/data/queries/use-site-visibility';
import type { SiteCreationVisibility, SiteVisibility, ProviderSitesInfo } from '@studio/providers';
import type { ComponentProps } from 'react';

type VisibilityOptions = NonNullable< ProviderSitesInfo[ 'visibility' ] >[ 'options' ];
type AccessOption = PickerOption< AccessValue >;

function AccessPicker( {
	value,
	checking = false,
	...props
}: Omit< ComponentProps< typeof PickerRow< AccessValue > >, 'label' | 'icon' | 'valueLabel' > ) {
	const selected = props.options.find( ( option ) => option.value === value );
	return (
		<PickerRow
			{ ...props }
			value={ value }
			checking={ checking }
			label={ __( 'Who can view' ) }
			icon={ ( option ) => <VisibilityIcon value={ option } /> }
			valueLabel={ checking ? __( 'Checking access…' ) : selected?.label ?? __( 'Access unknown' ) }
		/>
	);
}

export function PreviewAccessControl( {
	publicSelected,
	readOnly,
	disabled,
	onPublicSelectedChange,
}: {
	publicSelected: boolean;
	readOnly: boolean;
	disabled: boolean;
	onPublicSelectedChange: ( selected: boolean ) => void;
} ) {
	const link: AccessOption = {
		value: 'link',
		label: __( 'Anyone with the link' ),
		description: __( 'Share a temporary preview link.' ),
	};
	if ( readOnly ) {
		return (
			<div className={ styles.publishedStatusRow }>
				<VisibilityIcon value={ link.value } />
				<span className={ styles.publishedStatusLabel }>{ link.label }</span>
			</div>
		);
	}
	return (
		<AccessPicker
			value={ publicSelected ? 'public' : 'link' }
			options={ [
				link,
				{
					value: 'public',
					label: __( 'Everyone' ),
					description: __( 'Launch a public site with a paid plan.' ),
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
	getOptions: VisibilityOptions;
	onChange: ( value: SiteCreationVisibility ) => void;
} ) {
	return (
		<AccessPicker
			value={ value }
			checking={ loading }
			options={ getOptions( value )
				.filter( ( option ) => option.value === 'private' || option.value === 'public' )
				.map( ( option ) => ( {
					...option,
					disabled: option.disabled || ( policy === 'private' && option.value === 'public' ),
				} ) ) }
			disabled={ disabled }
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
	getOptions: VisibilityOptions;
	managementLink?: { title: string; url: string };
} ) {
	const [ open, setOpen ] = useState( false );
	const saving = useRef( false );
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
			checking={ query.isPending }
			disabled={ disabled }
			open={ open }
			onOpenChange={ ( next, event ) => {
				if ( saving.current ) {
					event.cancel();
					return;
				}
				if ( next ) save.reset();
				setOpen( next );
			} }
			onValueChange={ ( next ) => {
				const option = options.find( ( option ) => option.value === next && ! option.disabled );
				if ( ! option || next === value ) return;
				saving.current = true;
				save.mutate( option.value, {
					onSuccess: () => setOpen( false ),
					onSettled: () => {
						saving.current = false;
					},
				} );
			} }
			managementAction={
				managementLink && {
					label: managementLink.title,
					disabled: save.isPending,
					onClick: () => void connector.openExternalUrl( managementLink.url ),
				}
			}
		>
			{ save.isError && (
				<p role="alert" className={ styles.accessPickerError }>
					{ save.error.message }
				</p>
			) }
			{ query.data?.message && (
				<p className={ styles.accessPickerError }>{ query.data.message }</p>
			) }
		</AccessPicker>
	);
}
