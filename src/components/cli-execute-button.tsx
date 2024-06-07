import { useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

interface CliExecuteButtonProps {
	projectPath: string;
}

export default function CliExecuteButton( { projectPath }: CliExecuteButtonProps ) {
	const [ args, setArgs ] = useState( '' );
	const [ loading, setLoading ] = useState( false );
	const [ output, setOutput ] = useState( { stdout: '', stderr: '' } );
	const [ error, setError ] = useState< string | null >( null );

	const handleExecute = async () => {
		setLoading( true );
		setError( null );
		setOutput( { stdout: '', stderr: '' } );

		try {
			const result = await getIpcApi().executeWPCLiInline( args.split( ' ' ), projectPath );
			setOutput( result );
		} catch ( err ) {
			if ( err instanceof Error ) {
				setError( err.message );
			} else {
				setError( 'An unknown error occurred' );
			}
		} finally {
			setLoading( false );
		}
	};

	return (
		<div className="flex flex-col space-y-2">
			<textarea
				value={ args }
				onChange={ ( e ) => setArgs( e.target.value ) }
				placeholder="Enter WP-CLI arguments"
				className="w-full p-2 border rounded"
			/>
			<Button onClick={ handleExecute } disabled={ loading } variant="primary">
				{ loading ? 'Running...' : 'Run WP-CLI' }
			</Button>
			{ output.stdout && (
				<pre className="bg-gray-800 text-white p-4 rounded">{ output.stdout }</pre>
			) }
			{ output.stderr && (
				<pre className="bg-red-800 text-white p-4 rounded">{ output.stderr }</pre>
			) }
			{ error && <pre className="bg-red-800 text-white p-4 rounded">{ error }</pre> }
		</div>
	);
}
