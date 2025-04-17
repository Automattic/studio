import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import { SupportedTerminal, supportedTerminalNames } from 'src/lib/terminal';

interface TerminalPickerProps {
	value: SupportedTerminal;
	onChange: ( value: SupportedTerminal ) => void;
}

export const TerminalPicker = ( { value, onChange }: TerminalPickerProps ) => {
	const { __ } = useI18n();
	const [ installedTerminals, setInstalledTerminals ] = useState< {
		iterm: boolean | null;
		terminal: boolean | null;
	} >( {
		iterm: null,
		terminal: null,
	} );

	useEffect( () => {
		const fetchInstalledTerminals = async () => {
			try {
				const terminals = { iterm: true, terminal: true }; // TODO:: Fetch installed terminals from the API
				setInstalledTerminals( terminals );
			} catch ( error ) {
				console.error( 'Failed to fetch installed terminals:', error );
			}
		};

		fetchInstalledTerminals();
	}, [] );

	const options = Object.entries( supportedTerminalNames ).map( ( [ terminal, label ] ) => {
		const terminalKey = terminal as SupportedTerminal;
		const isInstalled = installedTerminals[ terminalKey as keyof typeof installedTerminals ];

		return {
			value: terminalKey,
			label,
			disabled: ! isInstalled,
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
