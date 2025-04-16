import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedTerminal } from 'src/lib/supported-terminal';

export const useTerminalOptions = () => {
	const [ availableTerminals, setAvailableTerminals ] = useState< SupportedTerminal[] >( [
		'terminal',
	] );

	useEffect( () => {
		const loadTerminals = async () => {
			const installed = await getIpcApi().getInstalledTerminals();
			const available: SupportedTerminal[] = [ 'terminal' ];
			if ( installed.iterm ) {
				available.push( 'iterm' );
			}
			setAvailableTerminals( available );
		};
		loadTerminals();
	}, [] );

	return availableTerminals;
};
