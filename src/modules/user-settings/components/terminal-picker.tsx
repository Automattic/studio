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
	console.log( 'value', value );

	const availableTerminalEntries = Object.entries( supportedTerminalNames ).filter(
		( [ terminal ] ) => availableTerminals.includes( terminal as SupportedTerminal )
	);

	const unavailableTerminalEntries = Object.entries( supportedTerminalNames ).filter(
		( [ terminal ] ) => ! availableTerminals.includes( terminal as SupportedTerminal )
	);

	return (
		<SettingsFormField label={ __( 'Shell' ) }>
			<SelectControl
				value={ value }
				onChange={ ( newValue ) => onChange( newValue as SupportedTerminal ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				<optgroup label={ __( 'Available terminals' ) }>
					{ availableTerminalEntries.map( ( [ terminal, label ] ) => (
						<option key={ terminal } value={ terminal }>
							{ label }
						</option>
					) ) }
				</optgroup>
				{ unavailableTerminalEntries.length > 0 && (
					<optgroup label={ __( 'Not installed' ) }>
						{ unavailableTerminalEntries.map( ( [ terminal, label ] ) => (
							<option key={ terminal } value={ terminal } disabled>
								{ label }
							</option>
						) ) }
					</optgroup>
				) }
			</SelectControl>
		</SettingsFormField>
	);
};
