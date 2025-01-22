import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';
import { getIpcApi } from '../lib/get-ipc-api';
import { updateMessage } from '../stores/chat-slice';

export function useExecuteWPCLI(
	content: string,
	siteId: string | undefined,
	messageId: number | undefined
) {
	const [ cliOutput, setCliOutput ] = useState< string | null >( null );
	const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
	const [ cliTime, setCliTime ] = useState< string | null >( null );
	const [ isRunning, setIsRunning ] = useState( false );
	const dispatch = useDispatch();

	const handleExecute = useCallback( async () => {
		setIsRunning( true );
		const startTime = Date.now();
		const args = content.split( ' ' ).slice( 1 );
		const result = await getIpcApi().executeWPCLiInline( {
			siteId: siteId || '',
			args: args.join( ' ' ),
			skipPluginsAndThemes: false,
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

		if ( messageId !== undefined ) {
			dispatch(
				updateMessage( {
					cliOutput: result.stdout || result.stderr,
					cliStatus: result.stderr ? 'error' : 'success',
					cliTime: completedIn || '',
					codeBlockContent: content,
					messageId,
					siteId: siteId || '',
				} )
			);
		}
	}, [ content, dispatch, messageId, siteId ] );

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
