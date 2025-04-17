import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedTerminal, supportedTerminalNames } from 'src/lib/terminal';

interface TerminalPickerProps {
	value: SupportedTerminal;
	onChange: ( value: SupportedTerminal ) => void;
}

export const TerminalPicker = ( { value, onChange }: TerminalPickerProps ) => {
	const { __ } = useI18n();

	const options = Object.entries( supportedTerminalNames )
		.filter( ( [ terminal ] ) => {
			// Only include options that match 'terminal' or 'iterm'
			return terminal === 'terminal' || terminal === 'iterm';
		} )
		.map( ( [ terminal, label ] ) => {
			return {
				value: terminal as SupportedTerminal,
				label,
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
