import { buildSettingsLink } from '@studio/common/lib/settings-link';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { createContext, useContext, useId } from 'react';
import { useCopyText } from '@/data/host/use-copy-text';
import { findSettingId } from '@/data/settings-sections';
import { SettingsLinkContext } from '@/features/settings/settings-dialog/context';
import { LinkIcon } from '@/lib/icons';
import { Button, type ButtonProps } from '@/lib/ui';
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLegend,
	FieldSet,
	FieldTitle,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	VisuallyHidden,
} from '@/lib/ui';
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
		// Without a heading the card isn't a group of its own, only its rows are.
		<FieldSet role={ title ? undefined : 'none' }>
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

type ControlProps = { 'aria-describedby'?: string; 'aria-invalid'?: true };

// Points a row's control at the row's description or error.
const SettingsRowContext = createContext< ControlProps >( {} );

/** A setting: its name and description on the left, its control on the right. */
export function SettingsRow( {
	title,
	badge,
	description,
	additionalContent,
	error,
	stacked = false,
	children,
}: {
	title: string;
	// Shown next to the title, like a "Connected" status.
	badge?: ReactNode;
	description?: ReactNode;
	// Shown under the description, like a link to a related section.
	additionalContent?: ReactNode;
	// Shown in place of the description.
	error?: string;
	// Puts the control on its own line, for wide controls.
	stacked?: boolean;
	// SettingsToggle and SettingsSelect find the row's description themselves;
	// other controls take it from a function child.
	children?: ReactNode | ( ( control: ControlProps ) => ReactNode );
} ) {
	const id = useContext( SettingsLinkContext ) ? findSettingId( title ) : undefined;
	const rowId = useId();
	const hasDescription = !! ( description || additionalContent || error );
	const control: ControlProps = {
		'aria-describedby': hasDescription ? `${ rowId }-description` : undefined,
		'aria-invalid': error ? true : undefined,
	};
	const content = typeof children === 'function' ? children( control ) : children;
	const fieldTitle = <FieldTitle id={ `${ rowId }-title` }>{ title }</FieldTitle>;
	return (
		<Field
			orientation={ stacked || ! content ? 'vertical' : 'horizontal' }
			className={ styles.settingsRow }
			aria-labelledby={ `${ rowId }-title` }
			data-settings-row
			data-setting-id={ id }
		>
			<FieldContent>
				{ id || badge ? (
					<div className={ styles.rowTitle }>
						{ fieldTitle }
						{ badge }
						{ id ? <SettingLinkButton id={ id } title={ title } /> : null }
					</div>
				) : (
					fieldTitle
				) }
				{ hasDescription ? (
					<FieldDescription
						id={ `${ rowId }-description` }
						className={ styles.rowDescription }
						width={ content ? 'default' : 'full' }
						error={ error }
						additionalContent={ additionalContent }
					>
						{ description }
					</FieldDescription>
				) : null }
			</FieldContent>
			{ content ? (
				<div className={ styles.settingsControl }>
					<SettingsRowContext.Provider value={ control }>{ content }</SettingsRowContext.Provider>
				</div>
			) : null }
		</Field>
	);
}

// Copies a wp-studio:// link that opens Settings on this setting.
function SettingLinkButton( { id, title }: { id: string; title: string } ) {
	const { copied, copy } = useCopyText( buildSettingsLink( id ) );
	return (
		<Button
			variant="inline-text"
			size="icon-inline"
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
			{ copied ? <CheckIcon /> : <LinkIcon /> }
			<VisuallyHidden aria-live="polite">{ copied ? __( 'Copied' ) : '' }</VisuallyHidden>
		</Button>
	);
}

/** A link to a related section, under a setting's description. */
export function SettingsSectionLink( { children, ...props }: ButtonProps ) {
	return (
		<Button variant="inline-link" size="inline" { ...props }>
			{ children }
			<ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
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
	const control = useContext( SettingsRowContext );
	return (
		<Switch
			{ ...control }
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
	const control = useContext( SettingsRowContext );
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
			<SelectTrigger size="sm" aria-label={ label } { ...control }>
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
