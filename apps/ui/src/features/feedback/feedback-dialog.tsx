import { REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { errorMessage } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSession } from '@/data/queries/use-sessions';
import { entriesToTranscriptItems } from '@/features/chats';
import { PlusIcon } from '@/lib/icons';
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
	FieldContent,
	FieldError,
	FieldGroup,
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
	{ value: 'bug', label: __( 'Bug report' ) },
	{ value: 'request', label: __( 'Feature request' ) },
	{ value: 'general', label: __( 'General feedback' ) },
];

const getAreaOptions = () => [
	{ value: 'new-site', label: __( 'New site' ) },
	{ value: 'blueprints', label: __( 'Blueprints' ) },
	{ value: 'import', label: __( 'Import' ) },
	{ value: 'agent', label: __( 'Agent' ) },
	{ value: 'preview', label: __( 'Preview' ) },
	{ value: 'sync', label: __( 'Sync' ) },
	{ value: 'publishing', label: __( 'Publishing' ) },
];

/**
 * Sends feedback to the WordPress Studio team without going through a chat. Opened by
 * the `feedback` search param (`?feedback=true`).
 */
export function FeedbackDialog() {
	return useConnector().sendFeedback ? <FeedbackDialogRoot /> : null;
}

function FeedbackDialogRoot() {
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
			<DialogContent layout="confirmation">
				<FeedbackForm />
			</DialogContent>
		</Dialog>
	);
}

function FeedbackForm() {
	const connector = useConnector();
	const navigate = useNavigate();
	const user = useAuthUser();
	const { sessionId } = useParams( { strict: false } ) as { sessionId?: string };
	const session = useSession( sessionId );
	const transcript = useMemo(
		() =>
			session.data ? transcriptToText( entriesToTranscriptItems( session.data.entries ) ) : '',
		[ session.data ]
	);
	const [ type, setType ] = useState< StudioFeedbackType | null >( null );
	const [ areas, setAreas ] = useState< string[] >( [] );
	const [ message, setMessage ] = useState( '' );
	const [ includeTranscript, setIncludeTranscript ] = useState( false );
	const messageId = useId();
	const transcriptId = useId();
	const send = useMutation( {
		mutationFn: ( feedback: { type: StudioFeedbackType; message: string } ) =>
			connector.sendFeedback!( feedback ),
	} );
	const options = getTypeOptions();

	if ( user.isSuccess && ! user.data ) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>{ __( 'Send feedback' ) }</DialogTitle>
					<DialogDescription>
						{ __(
							'Log in to WordPress.com to send feedback to the WordPress Studio team, or report it on GitHub.'
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
					<Button
						onClick={ () =>
							void navigate( {
								to: '.',
								state: true,
								search: ( { feedback: _feedback, ...rest }: Record< string, unknown > ) => ( {
									...rest,
									settings: 'ai',
								} ),
								replace: true,
							} )
						}
					>
						{ __( 'Log in' ) }
					</Button>
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
						{ createInterpolateElement(
							sprintf(
								/* translators: %s: the ID the feedback service assigned to the report */
								__(
									'Thanks for helping improve WordPress Studio. The reference ID for your feedback submission is <id>%s</id>.'
								),
								String( send.data.feedbackId )
							),
							{ id: <strong /> }
						) }
					</DialogDescription>
				</DialogHeader>
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
		const areaOptions = getAreaOptions();
		const report = areas.length
			? `Areas: ${ areaOptions
					.filter( ( area ) => areas.includes( area.value ) )
					.map( ( area ) => area.label )
					.join( ', ' ) }\n\n${ message.trim() }`
			: message.trim();
		const body =
			includeTranscript && transcript
				? `${ report }\n\n--- Chat transcript ---\n${ transcript }`
				: report;
		send.mutate( { type: type ?? 'general', message: body } );
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
			</DialogHeader>
			<FieldGroup>
				<Field>
					<FieldLabel>{ __( 'Topic' ) }</FieldLabel>
					<Select
						items={ options }
						value={ type }
						disabled={ sending }
						onValueChange={ ( next ) => next && setType( next as StudioFeedbackType ) }
					>
						<SelectTrigger fullWidth aria-label={ __( 'Feedback type' ) }>
							<SelectValue placeholder={ __( 'Choose a topic' ) } />
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
					<FieldLabel>{ __( 'Area' ) }</FieldLabel>
					<div className={ styles.areas } role="group" aria-label={ __( 'Feedback areas' ) }>
						{ getAreaOptions().map( ( area ) => {
							const selected = areas.includes( area.value );
							return (
								<Button
									key={ area.value }
									type="button"
									variant="outline"
									size="sm"
									shape="round"
									aria-pressed={ selected }
									disabled={ sending }
									onClick={ () =>
										setAreas( ( current ) =>
											selected
												? current.filter( ( value ) => value !== area.value )
												: [ ...current, area.value ]
										)
									}
								>
									{ selected ? (
										<CheckIcon data-icon="inline-start" />
									) : (
										<PlusIcon data-icon="inline-start" />
									) }
									{ area.label }
								</Button>
							);
						} ) }
					</div>
				</Field>
				<Field>
					<FieldLabel htmlFor={ messageId }>{ __( 'Message' ) }</FieldLabel>
					<Textarea
						id={ messageId }
						sizing="fixed"
						rows={ 6 }
						value={ message }
						disabled={ sending }
						placeholder={ __( 'Share details (required)' ) }
						onChange={ ( event ) => setMessage( event.target.value ) }
						autoFocus
					/>
					<FieldError>
						{ user.error
							? errorMessage( user.error )
							: send.error
							? errorMessage( send.error )
							: null }
					</FieldError>
				</Field>
				{ transcript ? (
					<Field orientation="horizontal">
						<Checkbox
							id={ transcriptId }
							checked={ includeTranscript }
							onCheckedChange={ setIncludeTranscript }
							disabled={ sending }
						/>
						<FieldContent>
							<FieldLabel htmlFor={ transcriptId } tone="muted">
								{ __( 'Include this chat’s transcript' ) }
							</FieldLabel>
						</FieldContent>
					</Field>
				) : null }
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={ <Button variant="outline" /> } disabled={ sending }>
					{ __( 'Cancel' ) }
				</DialogClose>
				<Button type="submit" variant="accent" disabled={ ! canSend }>
					{ sending ? <Spinner aria-hidden="true" /> : null }
					{ __( 'Send' ) }
				</Button>
			</DialogFooter>
		</form>
	);
}
