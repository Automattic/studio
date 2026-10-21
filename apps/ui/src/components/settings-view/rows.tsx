import { FormToggle } from '@wordpress/components';
import { SelectControl } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ReactNode } from 'react';

/** A grey card of setting rows, with an optional heading above it. */
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
		<div className={ styles.settingsGroup }>
			{ title ? (
				<div className={ styles.settingsGroupHeader }>
					<h3>{ title }</h3>
					{ description ? <p>{ description }</p> : null }
				</div>
			) : null }
			<div className={ styles.preferenceSectionGroup }>{ children }</div>
		</div>
	);
}

/** A setting: its name and description on the left, its control on the right. */
export function SettingsRow( {
	title,
	description,
	stacked = false,
	children,
}: {
	title: string;
	description?: ReactNode;
	// Puts the control on its own line, for wide controls.
	stacked?: boolean;
	children?: ReactNode;
} ) {
	return (
		<div
			className={ clsx( styles.preferenceRow, stacked && styles.preferenceRowStacked ) }
			data-settings-row
		>
			<div className={ styles.preferenceText }>
				<h2>{ title }</h2>
				{ description ? <p>{ description }</p> : null }
			</div>
			{ children ? <div className={ styles.preferenceControl }>{ children }</div> : null }
		</div>
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
		<span className={ styles.toggleControl }>
			<FormToggle
				aria-label={ label }
				checked={ checked }
				disabled={ disabled }
				onChange={ ( event ) => onChange( event.target.checked ) }
			/>
		</span>
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
		<SelectControl
			hideLabelFromVision
			className={ styles.selectControl }
			items={ options }
			label={ label }
			disabled={ disabled }
			value={ options.find( ( option ) => option.value === value ) ?? null }
			onValueChange={ ( item ) => {
				if ( item?.value !== undefined && item.value !== null ) {
					onChange( item.value as TValue );
				}
			} }
		/>
	);
}
