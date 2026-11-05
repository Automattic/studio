import { REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { useId, useMemo, useState } from 'react';
import { errorMessage } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSession } from '@/data/queries/use-sessions';
import { useOpenSettings } from '@/data/use-open-settings';
import { entriesToTranscriptItems } from '@/features/chats';
import {
	Button,
	Checkbox,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	FieldError,
	FieldLabel,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Spinner,
	Textarea,
} from '@/lib/ui';
import styles from './style.module.css';
import { transcriptToText } from './transcript-text';
import type { StudioFeedbackType } from '@studio/common/lib/feedback';

const getTypeOptions = (): Array< { value: StudioFeedbackType; label: string } > => [
	{ value: 'bug', label: __( 'Something is broken' ) },
	{ value: 'request', label: __( 'A feature or improvement' ) },
	{ value: 'general', label: __( 'Something else' ) },
];

/**
 * Sends feedback to the Studio team without going through a chat. Opened by
 * the `feedback` search param (`?feedback=true`).
 */
export function FeedbackDialog() {
	const navigate = useNavigate();
	const { feedback } = useSearch( { strict: false } ) as { feedback?: true };
	const close = () =>
		void navigate( {
			to: '.',
			state: true,
			search: ( { feedback: _feedback, ...rest }: Record< string, unknown > ) => rest,
			replace: true,
		} );

	return (
		<Dialog open={ !! feedback } onOpenChange={ ( open ) => ! open && close() }>
			<DialogContent layout="compact">{ feedback ? <FeedbackForm /> : null }</DialogContent>
		</Dialog>
	);
}

function FeedbackForm() {
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const user = useAuthUser();
	const { sessionId } = useParams( { strict: false } ) as { sessionId?: string };
	const session = useSession( sessionId );
	const transcript = useMemo(
		() =>
			session.data ? transcriptToText( entriesToTranscriptItems( session.data.entries ) ) : '',
		[ session.data ]
	);
	const [ type, setType ] = useState< StudioFeedbackType >( 'bug' );
	const [ message, setMessage ] = useState( '' );
	const [ includeTranscript, setIncludeTranscript ] = useState( false );
	const messageId = useId();
	const transcriptId = useId();
	const send = useMutation( {
		mutationFn: ( feedback: { type: StudioFeedbackType; message: string } ) =>
			connector.sendFeedback( feedback ),
	} );
	const options = getTypeOptions();

	if ( user.isSuccess && ! user.data ) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>{ __( 'Send feedback' ) }</DialogTitle>
					<DialogDescription>
						{ __(
							'Log in to WordPress.com to send feedback to the Studio team, or report it on GitHub.'
						) }
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={ () => void connector.openExternalUrl( REPORT_ISSUE_URL ) }
					>
						{ __( 'Open GitHub' ) }
					</Button>
					<DialogClose render={ <Button /> } onClick={ () => openSettings( 'ai' ) }>
						{ __( 'Log in' ) }
					</DialogClose>
				</DialogFooter>
			</>
		);
	}

	if ( send.isSuccess ) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>{ __( 'Feedback sent' ) }</DialogTitle>
					<DialogDescription>
						{ __( 'Thanks! The Studio team reviews reports in batches.' ) }
					</DialogDescription>
				</DialogHeader>
				<div className={ styles.sent }>
					<span className={ styles.reference }>
						{ sprintf(
							/* translators: %s: the ID the feedback service assigned to the report */
							__( 'Reference ID %s' ),
							String( send.data.feedbackId )
						) }
					</span>
				</div>
				<DialogFooter>
					<DialogClose render={ <Button /> }>{ __( 'Done' ) }</DialogClose>
				</DialogFooter>
			</>
		);
	}

	const sending = send.isPending;
	const canSend = message.trim().length > 0 && ! sending && user.isSuccess;
	const submit = () => {
		if ( ! canSend ) return;
		const body =
			includeTranscript && transcript
				? `${ message.trim() }\n\n--- Chat transcript ---\n${ transcript }`
				: message.trim();
		send.mutate( { type, message: body } );
	};

	return (
		<form
			className={ styles.form }
			onSubmit={ ( event ) => {
				event.preventDefault();
				submit();
			} }
		>
			<DialogHeader>
				<DialogTitle>{ __( 'Send feedback' ) }</DialogTitle>
				<DialogDescription>
					{ __( 'Goes to the Studio team at Automattic, with your Studio version and OS.' ) }
				</DialogDescription>
			</DialogHeader>
			<div className={ styles.fields }>
				<Field>
					<FieldLabel>{ __( 'What is it about?' ) }</FieldLabel>
					<Select
						items={ options }
						value={ type }
						disabled={ sending }
						onValueChange={ ( next ) => next && setType( next as StudioFeedbackType ) }
					>
						<SelectTrigger fullWidth aria-label={ __( 'Feedback type' ) }>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ options.map( ( option ) => (
								<SelectItem key={ option.value } value={ option.value }>
									{ option.label }
								</SelectItem>
							) ) }
						</SelectContent>
					</Select>
				</Field>
				<Field>
					<FieldLabel htmlFor={ messageId }>{ __( 'Message' ) }</FieldLabel>
					<Textarea
						id={ messageId }
						sizing="fixed"
						rows={ 6 }
						value={ message }
						disabled={ sending }
						placeholder={ __(
							'What were you trying to do, what happened, and what did you expect?'
						) }
						onChange={ ( event ) => setMessage( event.target.value ) }
						autoFocus
					/>
					<FieldError>{ send.error ? errorMessage( send.error ) : null }</FieldError>
				</Field>
				{ transcript ? (
					<Field orientation="horizontal">
						<Checkbox
							id={ transcriptId }
							checked={ includeTranscript }
							onCheckedChange={ setIncludeTranscript }
							disabled={ sending }
						/>
						<FieldLabel htmlFor={ transcriptId } tone="muted">
							{ __( 'Include this chat’s transcript' ) }
						</FieldLabel>
					</Field>
				) : null }
			</div>
			<DialogFooter>
				<DialogClose render={ <Button variant="outline" /> } disabled={ sending }>
					{ __( 'Cancel' ) }
				</DialogClose>
				<Button type="submit" disabled={ ! canSend }>
					{ sending ? <Spinner aria-hidden="true" /> : null }
					{ __( 'Send' ) }
				</Button>
			</DialogFooter>
		</form>
	);
}
