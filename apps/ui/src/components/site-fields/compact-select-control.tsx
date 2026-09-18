import { SelectControl } from '@wordpress/components';
import styles from './style.module.css';
import type { DataFormControlProps, Option } from '@wordpress/dataviews';

/**
 * Select for fields whose values are only a few characters wide, like a version
 * number. The default control spans the form, which leaves the value stranded
 * beside a long empty box and breaks the column rhythm on wide screens.
 */
export function CompactSelectControl< Item >( {
	data,
	field,
	onChange,
	hideLabelFromVision,
}: DataFormControlProps< Item > ) {
	const value = field.getValue( { item: data } ) ?? '';
	return (
		<SelectControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			className={ styles.compactSelect }
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			value={ value }
			disabled={ field.isDisabled( { item: data, field } ) }
			onChange={ ( newValue: string ) =>
				onChange( field.setValue( { item: data, value: newValue } ) )
			}
			options={ ( field.elements ?? [] ) as Option[] }
		/>
	);
}
