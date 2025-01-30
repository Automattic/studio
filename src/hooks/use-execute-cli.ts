import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';
import { getIpcApi } from '../lib/get-ipc-api';
import { chatActions } from '../stores/chat-slice';

export function useExecuteWPCLI(
	content: string,
	instanceId: string,
	siteId: string | undefined,
	messageId: number | undefined
) {
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
		const completedIn = sprintf( __( 'Completed in %s seconds' ), ( msTime / 1000 ).toFixed( 2 ) );
		setIsRunning( false );

		if ( messageId === undefined ) {
			return;
		}

		if ( result.exitCode === 0 ) {
			dispatch(
				chatActions.updateMessage( {
					cliOutput: result.stdout,
					cliStatus: 'success',
					cliTime: completedIn,
					codeBlockContent: content,
					messageId,
					instanceId,
				} )
			);
		} else {
			dispatch(
				chatActions.updateMessage( {
					cliOutput: result.stderr || __( 'Error when executing wp-cli command' ),
					cliStatus: 'error',
					cliTime: completedIn,
					codeBlockContent: content,
					messageId,
					instanceId,
				} )
			);
		}
	}, [ content, dispatch, messageId, siteId, instanceId ] );

	return {
		isRunning,
		handleExecute,
	};
}
