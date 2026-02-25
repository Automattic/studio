import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SettingsFormField } from './settings-form-field';

interface ColorSchemePickerProps {
	value: 'system' | 'light' | 'dark';
	onChange: ( value: 'system' | 'light' | 'dark' ) => void;
}

export const ColorSchemePicker = ( { value, onChange }: ColorSchemePickerProps ) => {
	const { __ } = useI18n();

	return (
		<SettingsFormField label={ __( 'Appearance' ) }>
			<SelectControl< 'system' | 'light' | 'dark' >
				value={ value }
				onChange={ onChange }
				options={ [
					{ label: __( 'System' ), value: 'system' },
					{ label: __( 'Light' ), value: 'light' },
					{ label: __( 'Dark' ), value: 'dark' },
				] }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			/>
		</SettingsFormField>
	);
};
