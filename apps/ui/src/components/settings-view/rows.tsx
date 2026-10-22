import { clsx } from 'clsx';
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
	description,
	error,
	stacked = false,
	children,
}: {
	title: string;
	description?: ReactNode;
	// Shown in place of the description.
	error?: string;
	// Puts the control on its own line, for wide controls.
	stacked?: boolean;
	children?: ReactNode;
} ) {
	return (
		<Field
			orientation={ stacked ? 'vertical' : 'horizontal' }
			className={ styles.settingsRow }
			data-settings-row
		>
			<FieldContent>
				<FieldTitle>{ title }</FieldTitle>
				{ description || error ? (
					<FieldDescription error={ error }>{ description }</FieldDescription>
				) : null }
			</FieldContent>
			{ children ? <div className={ styles.settingsControl }>{ children }</div> : null }
		</Field>
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
