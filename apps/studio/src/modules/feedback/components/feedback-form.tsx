import {
	CheckboxControl,
	SelectControl,
	TextareaControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import TextControl from 'src/components/text-control';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	MAX_FEEDBACK_MESSAGE_LENGTH,
	type FeedbackCategory,
	type FeedbackErrorCode,
} from 'src/modules/feedback/lib/feedback-schema';

export interface FeedbackIdentityProp {
	isAuthenticated: boolean;
	email?: string;
	displayName?: string;
}

interface FeedbackFormProps {
	identity?: FeedbackIdentityProp;
	source?: 'menu' | 'settings' | 'crash';
	onSubmitted?: () => void;
}

function categoryOptions(): { label: string; value: FeedbackCategory }[] {
	return [
		{ label: __( 'General feedback' ), value: 'general' },
		{ label: __( 'Bug report' ), value: 'bug' },
		{ label: __( 'Feature request' ), value: 'feature' },
		{ label: __( 'Something else' ), value: 'other' },
	];
}

function errorMessage( code: FeedbackErrorCode ): string {
	switch ( code ) {
		case 'validation':
			return __( 'Please enter a message before sending.' );
		case 'server':
			return __( 'Something went wrong on our end. Please try again.' );
		case 'network':
		case 'offline':
		default:
			return __( "Couldn't send feedback. Check your connection and try again." );
	}
}

export default function FeedbackForm( { identity, onSubmitted }: FeedbackFormProps ) {
	const [ message, setMessage ] = useState( '' );
	const [ email, setEmail ] = useState( '' );
	const [ category, setCategory ] = useState< FeedbackCategory >( 'general' );
	const [ includeLogs, setIncludeLogs ] = useState( true );
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const [ errorCode, setErrorCode ] = useState< FeedbackErrorCode | null >( null );
	const [ isSubmitted, setIsSubmitted ] = useState( false );

	const isLoggedOut = ! identity?.isAuthenticated;

	const resetForm = () => {
		setMessage( '' );
		setEmail( '' );
		setCategory( 'general' );
		setIncludeLogs( true );
		setErrorCode( null );
		setIsSubmitted( false );
	};

	const handleSubmit = async () => {
		if ( ! message.trim() || isSubmitting ) {
			return;
		}
		setIsSubmitting( true );
		setErrorCode( null );
		const result = await getIpcApi().submitFeedback( {
			message,
			email: isLoggedOut && email.trim() ? email.trim() : undefined,
			includeLogs,
			category,
		} );
		setIsSubmitting( false );
		if ( result.success ) {
			setIsSubmitted( true );
			onSubmitted?.();
		} else {
			setErrorCode( result.error );
		}
	};

	if ( isSubmitted ) {
		return (
			<VStack spacing="4" className="text-frame-text">
				<p className="text-frame-text">{ __( 'Thanks for your feedback!' ) }</p>
				<p className="text-frame-text-secondary text-[13px]">
					{ isLoggedOut
						? __(
								'If you left an email, we may reach out when there’s an update related to your report.'
						  )
						: __( 'We’ll reach out through your WordPress.com account if we have an update.' ) }
				</p>
				<div>
					<Button variant="secondary" onClick={ resetForm }>
						{ __( 'Send more feedback' ) }
					</Button>
				</div>
			</VStack>
		);
	}

	return (
		<VStack spacing="4">
			<SelectControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				label={ __( 'What kind of feedback is this?' ) }
				value={ category }
				options={ categoryOptions() }
				onChange={ ( value ) => setCategory( value as FeedbackCategory ) }
			/>

			<TextareaControl
				__nextHasNoMarginBottom
				label={ __( 'Your feedback' ) }
				placeholder={ __( 'What’s working well? What could be better?' ) }
				value={ message }
				onChange={ setMessage }
				rows={ 5 }
				maxLength={ MAX_FEEDBACK_MESSAGE_LENGTH }
			/>

			{ isLoggedOut && (
				<TextControl
					type="email"
					label={ __( 'Email (optional, so we can follow up)' ) }
					value={ email }
					onChange={ setEmail }
				/>
			) }

			<div className="flex items-center justify-between gap-3">
				<CheckboxControl
					__nextHasNoMarginBottom
					label={ __( 'Include recent app logs & diagnostics to help us debug' ) }
					checked={ includeLogs }
					onChange={ setIncludeLogs }
				/>
				<Button
					variant="link"
					className="!text-frame-theme shrink-0"
					onClick={ () => getIpcApi().openApplicationLogs() }
				>
					{ __( 'View logs' ) }
				</Button>
			</div>

			{ errorCode && (
				<p role="alert" className="text-a8c-red-50 text-[13px]">
					{ errorMessage( errorCode ) }
				</p>
			) }

			<div className="flex items-center gap-3">
				<Button
					variant="primary"
					className="bg-frame-theme text-white hover:text-white"
					onClick={ handleSubmit }
					disabled={ ! message.trim() || isSubmitting }
					aria-disabled={ ! message.trim() || isSubmitting }
					isBusy={ isSubmitting }
				>
					{ __( 'Send feedback' ) }
				</Button>
			</div>
		</VStack>
	);
}
