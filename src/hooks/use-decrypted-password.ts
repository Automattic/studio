import { useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export function useDecryptedPassword( encryptedPassword: string ): string | null {
	const [ decryptedPassword, setDecryptedPassword ] = useState< string | null >( null );

	useEffect( () => {
		let isCurrent = true;

		getIpcApi()
			.getDecryptedPassword( encryptedPassword )
			.then( ( value ) => {
				if ( isCurrent ) {
					setDecryptedPassword( value );
				}
			} );

		return () => {
			isCurrent = false;
		};
	}, [ encryptedPassword ] );

	return decryptedPassword;
}
