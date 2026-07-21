import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { TextareaControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function StudioCodeTab() {
	const { __ } = useI18n();
	const [ content, setContent ] = useState< string | null >( null );
	const [ savedContent, setSavedContent ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	useEffect( () => {
		let cancelled = false;
		getIpcApi()
			.getGlobalAgentInstructions()
			.then( ( instructions ) => {
				if ( ! cancelled ) {
					setContent( instructions );
					setSavedContent( instructions );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setError( getErrorMessage( err ) ?? String( err ) );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [] );

	const handleSave = async () => {
		if ( content === null ) {
			return;
		}
		setIsSaving( true );
		setError( null );
		try {
			await getIpcApi().saveGlobalAgentInstructions( content );
			setSavedContent( content );
		} catch ( err ) {
			setError( getErrorMessage( err ) ?? String( err ) );
		} finally {
			setIsSaving( false );
		}
	};

	return (
		<div className="flex flex-col gap-4 pb-2">
			{ error && <div className="text-sm text-frame-error">{ error }</div> }

			<TextareaControl
				__nextHasNoMarginBottom
				label={ __( 'Instructions' ) }
				help={ __(
					'Global instructions for the Studio Code agent. They are included in every new conversation, across all sites.'
				) }
				rows={ 12 }
				value={ content ?? '' }
				onChange={ setContent }
				disabled={ content === null }
				placeholder={ __( 'e.g. Always answer in French. My sites are for restaurants.' ) }
			/>

			<div className="flex justify-end">
				<Button
					variant="primary"
					onClick={ handleSave }
					disabled={ content === null || isSaving || content === savedContent }
				>
					{ isSaving ? __( 'Saving…' ) : __( 'Save instructions' ) }
				</Button>
			</div>
		</div>
	);
}
