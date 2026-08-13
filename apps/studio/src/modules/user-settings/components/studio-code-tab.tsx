import { GLOBAL_INSTRUCTIONS_MAX_LENGTH } from '@studio/common/ai/global-instructions';
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
	const [ justSaved, setJustSaved ] = useState( false );
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

	useEffect( () => {
		if ( ! justSaved ) {
			return;
		}
		const timer = setTimeout( () => setJustSaved( false ), 2500 );
		return () => clearTimeout( timer );
	}, [ justSaved ] );

	const handleSave = async () => {
		if ( content === null ) {
			return;
		}
		setIsSaving( true );
		setError( null );
		try {
			// The button only enables while dirty, so every save here closes an edit session.
			await getIpcApi().saveGlobalAgentInstructions( content, {
				editSession: { previousContent: savedContent },
			} );
			setSavedContent( content );
			setJustSaved( true );
		} catch ( err ) {
			setError( getErrorMessage( err ) ?? String( err ) );
		} finally {
			setIsSaving( false );
		}
	};

	const isDirty = content !== null && content !== savedContent;
	const showCounter = content !== null && content.length >= GLOBAL_INSTRUCTIONS_MAX_LENGTH * 0.8;
	const buttonLabel = isSaving
		? __( 'Saving…' )
		: justSaved && ! isDirty
		? __( 'Saved' )
		: __( 'Save instructions' );

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
				maxLength={ GLOBAL_INSTRUCTIONS_MAX_LENGTH }
				value={ content ?? '' }
				onChange={ setContent }
				disabled={ content === null }
				placeholder={ __( 'e.g. Always answer in French. My sites are for restaurants.' ) }
			/>

			<div className="flex items-center justify-end gap-3">
				{ showCounter && (
					<span className="text-xs text-frame-text-secondary">
						{ `${ content.length.toLocaleString() } / ${ GLOBAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString() }` }
					</span>
				) }
				<Button
					variant="primary"
					onClick={ handleSave }
					disabled={ content === null || isSaving || ! isDirty }
				>
					{ buttonLabel }
				</Button>
			</div>
		</div>
	);
}
