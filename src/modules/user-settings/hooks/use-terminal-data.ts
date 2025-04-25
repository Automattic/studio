import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedTerminal, DEFAULT_TERMINAL } from 'src/modules/user-settings/lib/terminal';

/**
 * Hook to manage terminal preferences
 */
export function useTerminalData() {
	const [ terminal, setTerminal ] = useState< SupportedTerminal >( DEFAULT_TERMINAL );
	const [ savedTerminalValue, setSavedTerminalValue ] =
		useState< SupportedTerminal >( DEFAULT_TERMINAL );
	const [ availableTerminals, setAvailableTerminals ] = useState< SupportedTerminal[] >( [
		'terminal',
	] );

	const getSavedTerminal = async () => {
		const userTerminal = await getIpcApi().getUserTerminal();
		return userTerminal || DEFAULT_TERMINAL;
	};

	// Load the saved terminal value
	useEffect( () => {
		const loadSavedTerminal = async () => {
			const terminal = await getSavedTerminal();
			setSavedTerminalValue( terminal );
			setTerminal( terminal );
		};
		void loadSavedTerminal();
	}, [] );

	// Load available terminals
	useEffect( () => {
		const loadTerminals = async () => {
			const installed = await getIpcApi().getInstalledTerminals();

			const available: SupportedTerminal[] = [ 'terminal' ];

			Object.entries( installed ).forEach( ( [ key, isInstalled ] ) => {
				if ( key !== 'terminal' && isInstalled ) {
					available.push( key as SupportedTerminal );
				}
			} );

			setAvailableTerminals( available );
		};
		void loadTerminals();
	}, [] );

	const handleTerminalChange = ( newTerminal: SupportedTerminal ) => {
		setTerminal( newTerminal );
	};

	const saveTerminalPreference = async () => {
		await getIpcApi().saveUserTerminal( terminal );
		setSavedTerminalValue( terminal );
	};

	const resetTerminal = () => {
		setTerminal( savedTerminalValue );
	};

	const hasTerminalChanges = terminal !== savedTerminalValue;

	return {
		terminal,
		savedTerminalValue,
		availableTerminals,
		handleTerminalChange,
		saveTerminalPreference,
		resetTerminal,
		hasTerminalChanges,
		getSavedTerminal,
	};
}
