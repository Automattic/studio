import { buildSettingsLink } from '@studio/common/lib/settings-link';
import { __, sprintf } from '@wordpress/i18n';
import { check, Icon, link } from '@wordpress/icons';
import { clsx } from 'clsx';
import { useContext } from 'react';
import { SettingsLinkContext } from '@/components/settings-dialog/context';
import { findSettingId } from '@/components/settings-dialog/sections';
import { Button } from '@/components/ui/button';
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from '@/components/ui/field';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { useCopyText } from '@/hooks/use-copy-text';
import styles from './style.module.css';
import type { ReactNode } from 'react';

/** A card of setting rows, with an optional heading above it. */
export function SettingsGroup( {
	title,
	description,
	children,
}: {
	title?: string;
	description?: ReactNode;
	children: ReactNode;
} ) {
	return (
		<FieldSet>
			{ title ? (
				<FieldLegend variant="label" className={ clsx( description && styles.groupLegend ) }>
					{ title }
				</FieldLegend>
			) : null }
			{ description ? (
				<FieldDescription width="full" className={ styles.groupDescription }>
					{ description }
				</FieldDescription>
			) : null }
			<FieldGroup variant="settings">{ children }</FieldGroup>
		</FieldSet>
	);
}

/** A setting: its name and description on the left, its control on the right. */
export function SettingsRow( {
	title,
	badge,
	description,
	error,
	stacked = false,
	children,
}: {
	title: string;
	// Shown next to the title, like a "Connected" status.
	badge?: ReactNode;
	description?: ReactNode;
	// Shown in place of the description.
	error?: string;
	// Puts the control on its own line, for wide controls.
	stacked?: boolean;
	children?: ReactNode;
} ) {
	const id = useContext( SettingsLinkContext ) ? findSettingId( title ) : undefined;
	return (
		<Field
			orientation={ stacked ? 'vertical' : 'horizontal' }
			className={ styles.settingsRow }
			data-settings-row
			data-setting-id={ id }
		>
			<FieldContent>
				{ id || badge ? (
					<div className={ styles.rowTitle }>
						<FieldTitle>{ title }</FieldTitle>
						{ badge }
						{ id ? <SettingLinkButton id={ id } title={ title } /> : null }
					</div>
				) : (
					<FieldTitle>{ title }</FieldTitle>
				) }
				{ description || error ? (
					<FieldDescription error={ error }>{ description }</FieldDescription>
				) : null }
			</FieldContent>
			{ children ? <div className={ styles.settingsControl }>{ children }</div> : null }
		</Field>
	);
}

// Copies a wp-studio:// link that opens Settings on this setting.
function SettingLinkButton( { id, title }: { id: string; title: string } ) {
	const { copied, copy } = useCopyText( buildSettingsLink( id ) );
	return (
		<Button
			variant="muted-ghost"
			size="icon-xs"
			className={ styles.linkButton }
			data-settings-link
			data-copied={ copied || undefined }
			aria-label={ sprintf(
				/* translators: %s: a setting's name. */
				__( 'Copy link to %s' ),
				title
			) }
			onClick={ copy }
		>
			<Icon icon={ copied ? check : link } fill="currentColor" aria-hidden="true" />
			<VisuallyHidden aria-live="polite">{ copied ? __( 'Copied' ) : '' }</VisuallyHidden>
		</Button>
	);
}

export function SettingsToggle( {
	label,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: ( checked: boolean ) => void;
} ) {
	return (
		<Switch
			aria-label={ label }
			checked={ checked }
			disabled={ disabled }
			onCheckedChange={ ( next ) => onChange( next ) }
		/>
	);
}

export function SettingsSelect< TValue extends string >( {
	label,
	value,
	options,
	disabled,
	onChange,
}: {
	label: string;
	value: TValue;
	options: Array< { value: TValue; label: string } >;
	disabled?: boolean;
	onChange: ( value: TValue ) => void;
} ) {
	return (
		<Select
			items={ options }
			value={ options.some( ( option ) => option.value === value ) ? value : null }
			disabled={ disabled }
			onValueChange={ ( next ) => {
				if ( next !== null ) {
					onChange( next );
				}
			} }
		>
			<SelectTrigger size="sm" aria-label={ label }>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{ options.map( ( option ) => (
					<SelectItem key={ option.value } value={ option.value }>
						{ option.label }
					</SelectItem>
				) ) }
			</SelectContent>
		</Select>
	);
}

// Loading, or a failed load with Retry.
export function SettingsLoadState( {
	loadFailed,
	onRetry,
}: {
	loadFailed: boolean;
	onRetry: () => void;
} ) {
	return (
		<div className={ styles.state }>
			{ loadFailed ? (
				<>
					{ __( "Couldn't load your settings." ) }{ ' ' }
					<Button variant="outline" onClick={ onRetry }>
						{ __( 'Retry' ) }
					</Button>
				</>
			) : (
				__( 'Loading…' )
			) }
		</div>
	);
}
