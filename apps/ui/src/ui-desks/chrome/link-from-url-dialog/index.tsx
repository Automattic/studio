import { __ } from '@wordpress/i18n';
import { arrowUp } from '@wordpress/icons';
import { useEffect, useRef, useState } from 'react';
import {
	Button,
	Dialog,
	DialogError,
	DialogRow,
	DialogTip,
	dialogInputClassName,
} from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { createUrlPastePayload } from '@/ui-desks/widget-actions/paste-handlers';

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
		<Dialog
			ariaLabel={ __( 'New link from URL' ) }
			as="form"
			gap="compact"
			onClose={ onClose }
			size="narrow"
			onSubmit={ ( event ) => {
				event.preventDefault();
				void submit();
			} }
		>
			<DialogRow align="center">
				<input
					ref={ inputRef }
					type="text"
					inputMode="url"
					className={ dialogInputClassName }
					value={ text }
					placeholder={ __( 'Paste a URL...' ) }
					onChange={ ( event ) => setText( event.target.value ) }
				/>
				<Button
					icon={ arrowUp }
					label={ __( 'Create link' ) }
					disabled={ ! canSubmit }
					onClick={ () => void submit() }
					tooltipSide="left"
					variant="filled"
					tone="primary"
					size="large"
				/>
			</DialogRow>
			<DialogTip>
				{ __( 'Tip: you can also paste a URL anywhere on the canvas to drop it directly.' ) }
			</DialogTip>
			{ error && <DialogError>{ error }</DialogError> }
		</Dialog>
	);
}
