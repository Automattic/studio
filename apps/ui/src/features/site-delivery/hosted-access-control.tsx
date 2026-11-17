import { __ } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { ExternalLinkIcon } from '@/lib/icons';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/lib/ui';
import styles from './style.module.css';
import type { useSiteVisibility } from '@/data/queries/use-site-visibility';
import type { SiteCreationVisibility, SiteVisibility, ProviderSitesInfo } from '@studio/providers';
import type { ComponentProps, ReactNode } from 'react';

const manageVisibility = 'manage-visibility';

function AccessPicker( {
	value,
	options,
	disabled,
	checking = false,
	open,
	onOpenChange,
	onValueChange,
	managementAction,
	children,
}: {
	value: string | undefined;
	options: { value: string; label: string; description: string; disabled?: boolean }[];
	disabled: boolean;
	checking?: boolean;
	open?: boolean;
	onOpenChange?: ComponentProps< typeof Select >[ 'onOpenChange' ];
	onValueChange: ( value: string ) => void;
	managementAction?: { label: string; onClick: () => void; disabled: boolean };
	children?: ReactNode;
} ) {
	const selected = options.find( ( option ) => option.value === value );
	const label = checking ? __( 'Checking…' ) : selected?.label ?? __( 'Unknown' );
	return (
		<div>
			<Select
				items={
					managementAction
						? [ ...options, { value: manageVisibility, label: managementAction.label } ]
						: options
				}
				value={ selected?.value ?? null }
				open={ open }
				disabled={ disabled }
				onOpenChange={ onOpenChange }
				onValueChange={ ( next ) => {
					if ( next === manageVisibility ) managementAction?.onClick();
					else if ( next !== null ) onValueChange( next );
				} }
			>
				<SelectTrigger
					variant="ghost"
					fullWidth
					className={ styles.accessTrigger }
					aria-label={ __( 'Who can view' ) }
					aria-description={ label }
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 256 256"
						fill="currentColor"
						aria-hidden="true"
						data-icon="inline-start"
					>
						<path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z" />
					</svg>
					<span className={ styles.accessTriggerLabel }>{ __( 'Who can view' ) }</span>
					<span className={ styles.accessTriggerEnd }>
						<SelectValue className={ checking ? 'studio-shimmer' : undefined }>
							{ label }
						</SelectValue>
					</span>
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={ false }>
					{ options.map( ( option ) => (
						<SelectItem
							key={ option.value }
							value={ option.value }
							label={ option.label }
							disabled={ option.disabled }
							aria-label={ option.label }
							aria-description={ option.description }
							description={ option.description }
						>
							{ option.label }
						</SelectItem>
					) ) }
					{ children }
					{ managementAction && (
						<SelectGroup className={ styles.selectActions }>
							<SelectItem
								value={ manageVisibility }
								label={ managementAction.label }
								disabled={ managementAction.disabled }
							>
								{ managementAction.label }
								<ExternalLinkIcon />
							</SelectItem>
						</SelectGroup>
					) }
				</SelectContent>
			</Select>
		</div>
	);
}

export function PreviewAccessControl( {
	publicSelected,
	disabled,
	onPublicSelectedChange,
}: {
	publicSelected: boolean;
	disabled: boolean;
	onPublicSelectedChange: ( selected: boolean ) => void;
} ) {
	return (
		<AccessPicker
			value={ publicSelected ? 'public' : 'link' }
			options={ [
				{
					value: 'link',
					label: __( 'Anyone with the link' ),
					description: __( 'Share a temporary preview link.' ),
				},
				{
					value: 'public',
					label: __( 'Everyone' ),
					description: __( 'Full WordPress with a custom domain.' ),
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
	getOptions: NonNullable< ProviderSitesInfo[ 'visibilityOptions' ] >;
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
