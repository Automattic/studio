import { useState, useEffect } from 'react';
import { SupportedTerminal, DEFAULT_TERMINAL } from 'src/lib/terminal';

/**
 * Hook to manage terminal preferences
 */
export function useTerminalData() {
	const [ terminal, setTerminal ] = useState< SupportedTerminal >( DEFAULT_TERMINAL );
	const [ savedTerminalValue, setSavedTerminalValue ] =
		useState< SupportedTerminal >( DEFAULT_TERMINAL );

	const getSavedTerminal = async () => {
		// TODO::Get the actual terminal from the IPC API
		return DEFAULT_TERMINAL;
	};

	// Load the saved terminal value
	useEffect( () => {
		const loadSavedTerminal = async () => {
			const terminal = await getSavedTerminal();
			setSavedTerminalValue( terminal );
			setTerminal( terminal );
		};
		loadSavedTerminal();
	}, [] );

	const handleTerminalChange = ( newTerminal: SupportedTerminal ) => {
		setTerminal( newTerminal );
	};

	const saveTerminalPreference = async () => {
		//TODO:: Save the terminal preference to the IPC API
		alert( terminal );
	};

	const resetTerminal = () => {
		setTerminal( savedTerminalValue );
	};

	const hasTerminalChanges = terminal !== savedTerminalValue;

	return {
		terminal,
		savedTerminalValue,
		handleTerminalChange,
		saveTerminalPreference,
		resetTerminal,
		hasTerminalChanges,
	};
}
