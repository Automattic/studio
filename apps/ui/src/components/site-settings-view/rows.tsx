import { SettingsRow, SettingsSelect, SettingsToggle } from '@/components/settings-view/rows';
import type { DataFormControlProps } from '@wordpress/dataviews';
import type { ComponentType, ReactNode } from 'react';

// DataForm controls laid out as settings rows: the title and description on
// the left, the control on the right.

export function textRow< Item >(
	Control: ComponentType< DataFormControlProps< Item > >,
	title: string,
	description?: ReactNode
) {
	return function TextRow( props: DataFormControlProps< Item > ) {
		return (
			<SettingsRow title={ title } description={ description }>
				<Control
					{ ...props }
					hideLabelFromVision
					field={ { ...props.field, description: undefined } }
				/>
			</SettingsRow>
		);
	};
}

export function toggleRow< Item >( title: string, description?: ReactNode ) {
	return function ToggleRow( { data, field, onChange }: DataFormControlProps< Item > ) {
		return (
			<SettingsRow title={ title } description={ description ?? field.description }>
				<SettingsToggle
					label={ title }
					checked={ !! field.getValue( { item: data } ) }
					disabled={ field.isDisabled( { item: data, field } ) }
					onChange={ ( value ) => onChange( field.setValue( { item: data, value } ) ) }
				/>
			</SettingsRow>
		);
	};
}

// The select shows an empty value as no selection, so '' travels as this.
const EMPTY = '\u0000';
const encode = ( value: unknown ) => ( value === '' ? EMPTY : String( value ?? '' ) );

export function selectRow< Item >( title: string, description?: ReactNode ) {
	return function SelectRow( { data, field, onChange }: DataFormControlProps< Item > ) {
		return (
			<SettingsRow title={ title } description={ description ?? field.description }>
				<SettingsSelect
					label={ title }
					value={ encode( field.getValue( { item: data } ) ) }
					options={ ( field.elements ?? [] )
						.filter( ( element ) => ! ( element as { hidden?: boolean } ).hidden )
						.map( ( element ) => ( { value: encode( element.value ), label: element.label } ) ) }
					disabled={ field.isDisabled( { item: data, field } ) }
					onChange={ ( value ) =>
						onChange( field.setValue( { item: data, value: value === EMPTY ? '' : value } ) )
					}
				/>
			</SettingsRow>
		);
	};
}
