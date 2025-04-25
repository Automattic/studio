import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedTerminal, supportedTerminalNames } from 'src/modules/user-settings/lib/terminal';
import { SettingsFormField } from './settings-form-field';

interface TerminalPickerProps {
	value: SupportedTerminal;
	onChange: ( value: SupportedTerminal ) => void;
	availableTerminals?: SupportedTerminal[];
}

export const TerminalPicker = ( {
	value,
	onChange,
	availableTerminals = [ 'terminal' ],
}: TerminalPickerProps ) => {
	const { __ } = useI18n();

	const options = Object.entries( supportedTerminalNames ).map( ( [ terminal, label ] ) => {
		const terminalKey = terminal as SupportedTerminal;
		const isAvailable = availableTerminals.includes( terminalKey );

		return {
			value: terminalKey,
			label,
			disabled: ! isAvailable,
		};
	} );

	return (
		<SettingsFormField label={ __( 'Shell' ) }>
			<SelectControl
				value={ value }
				onChange={ onChange }
				options={ options }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			/>
		</SettingsFormField>
	);
};
