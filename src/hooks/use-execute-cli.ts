import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export function useExecuteWPCLI(
	content: string,
	siteId: string | undefined,
	updateMessage:
		| ( (
				id: number,
				content: string,
				output: string,
				status: 'success' | 'error',
				time: string
		  ) => void )
		| undefined,
	messageId: number | undefined
) {
	const [ cliOutput, setCliOutput ] = useState< string | null >( null );
	const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
	const [ cliTime, setCliTime ] = useState< string | null >( null );
	const [ isRunning, setIsRunning ] = useState( false );

	const handleExecute = useCallback( async () => {
		setIsRunning( true );
		const startTime = Date.now();
		const args = content.split( ' ' ).slice( 1 );
		const result = await getIpcApi().executeWPCLiInline( {
			siteId: siteId || '',
			args: args.join( ' ' ),
		} );

		const msTime = Date.now() - startTime;
		if ( result.stderr ) {
			setCliOutput( result.stderr );
			setCliStatus( 'error' );
		} else {
			setCliOutput( result.stdout );
			setCliStatus( 'success' );
		}
		const completedIn = sprintf( __( 'Completed in %s seconds' ), ( msTime / 1000 ).toFixed( 2 ) );
		setCliTime( completedIn );
		setIsRunning( false );

		if ( updateMessage && messageId !== undefined ) {
			updateMessage(
				messageId,
				content,
				result.stdout || result.stderr,
				result.stderr ? 'error' : 'success',
				completedIn || ''
			);
		}
	}, [ content, messageId, siteId, updateMessage ] );

	return {
		cliOutput,
		cliStatus,
		cliTime,
		isRunning,
		handleExecute,
		setCliOutput,
		setCliStatus,
		setCliTime,
	};
}
