import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import {
	PromptDialog,
	PromptDialogError,
	PromptDialogRow,
	PromptDialogSubmit,
	PromptDialogTip,
	promptDialogInputClassName,
} from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { createUrlPastePayload } from '@/ui-desks/widgets/paste-handlers';

interface LinkFromUrlDialogProps {
	center?: {
		x: number;
		y: number;
	};
	onClose: () => void;
}

export function LinkFromUrlDialog( { center, onClose }: LinkFromUrlDialogProps ) {
	const desk = useDesk();
	const inputRef = useRef< HTMLInputElement | null >( null );
	const [ text, setText ] = useState( '' );
	const [ error, setError ] = useState< string | null >( null );
	const payload = createUrlPastePayload( text );
	const canSubmit = Boolean( payload ) && desk.canAddWidgets;

	useEffect( () => {
		inputRef.current?.focus();
	}, [] );

	const submit = async () => {
		if ( ! payload ) {
			setError( __( 'Enter a valid URL.' ) );
			return;
		}

		setError( null );
		const didAdd = await desk.addPastedContent( payload, center ? { center } : undefined );
		if ( didAdd ) {
			onClose();
			return;
		}

		setError( __( 'Unable to create a link from this URL.' ) );
	};

	return (
		<PromptDialog
			ariaLabel={ __( 'New link from URL' ) }
			gap="compact"
			onClose={ onClose }
			size="narrow"
			onSubmit={ ( event ) => {
				event.preventDefault();
				void submit();
			} }
		>
			<PromptDialogRow align="center">
				<input
					ref={ inputRef }
					type="text"
					inputMode="url"
					className={ promptDialogInputClassName }
					value={ text }
					placeholder={ __( 'Paste a URL...' ) }
					onChange={ ( event ) => setText( event.target.value ) }
				/>
				<PromptDialogSubmit
					label={ __( 'Create link' ) }
					disabled={ ! canSubmit }
					onClick={ () => void submit() }
				/>
			</PromptDialogRow>
			<PromptDialogTip>
				{ __( 'Tip: you can also paste a URL anywhere on the canvas to drop it directly.' ) }
			</PromptDialogTip>
			{ error && <PromptDialogError>{ error }</PromptDialogError> }
		</PromptDialog>
	);
}
