import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedTerminal, supportedTerminalNames } from 'src/lib/terminal';

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
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Shell' ) }</h2>
			<SelectControl
				value={ value }
				onChange={ onChange }
				options={ options }
				__nextHasNoMarginBottom
				className="mb-2"
			/>
		</div>
	);
};
