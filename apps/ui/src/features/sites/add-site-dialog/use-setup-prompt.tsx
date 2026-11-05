import {
	getEffectiveSessionProvider,
	resolveSessionModelForProvider,
} from '@studio/agent/protocol/providers';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { canUsePaidAiModels } from '@studio/common/lib/studio-assistant-quota';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { openNewSession, SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import {
	Composer,
	pendingPromptSlot,
	useComposerNotice,
	type ComposerHandle,
} from '@/features/composer';
import { Alert, AlertDescription, AlertTitle, Button, Field, FieldTitle } from '@/lib/ui';
import { useAddSite } from './context';
import styles from './style.module.css';
import type { CreateSiteFormError } from '@/features/sites/create-site-form';

export function useSetupPrompt( { enabled = true, busy = false } = {} ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { setProgress, formActions, briefDraftKey, aiChoice, setAiChoice, source } = useAddSite();
	const composer = useRef< ComposerHandle >( null );
	const createdSiteId = useRef< string | undefined >( undefined );
	const chatId = useRef< string | undefined >( undefined );
	const brief = useRef< ReturnType< ComposerHandle[ 'getSubmission' ] > >( null );
	const [ error, setError ] = useState< CreateSiteFormError >();
	const [ retrying, setRetrying ] = useState( false );
	const { data: settings } = useAiSettings();
	const { data: quota } = useStudioAssistantQuota();
	const { data: user } = useAuthUser();
	const provider = aiChoice?.provider ?? getEffectiveSessionProvider( [], settings );
	const notice = useComposerNotice( provider );
	const providerConnected = provider === 'wpcom' ? !! user : !! settings?.hasAnthropicApiKey;
	const model =
		aiChoice?.model ??
		resolveSessionModelForProvider( [], provider, {
			canUsePaidModels: canUsePaidAiModels( quota, user?.email ),
		} );
	const openSite = () =>
		navigate( { to: '/sites/$siteId/new', params: { siteId: createdSiteId.current! } } );
	const startChat = async () => {
		if ( ! createdSiteId.current || ! brief.current ) return;
		setRetrying( true );
		setProgress( __( 'Starting chat…' ) );
		try {
			chatId.current ??= (
				await openNewSession( { connector, queryClient }, createdSiteId.current )
			).id;
			await connector.setSessionProvider( chatId.current, provider, model );
			queryClient.setQueryData(
				[ ...SESSIONS_QUERY_KEY, chatId.current ],
				await connector.getSession( chatId.current )
			);
			pendingPromptSlot.set( {
				sessionId: chatId.current,
				prompt:
					brief.current.prompt || __( 'Build this site using the attached files as references.' ),
				attachments: brief.current.attachments,
			} );
			await navigate( { to: '/sessions/$sessionId', params: { sessionId: chatId.current } } );
		} catch ( failure ) {
			setError( {
				title: __( 'Your site was created, but the AI chat could not start.' ),
				message: __( 'Try starting the chat again, or open your site.' ),
				details: getErrorMessage( failure ),
			} );
		} finally {
			setProgress( null );
			setRetrying( false );
		}
	};
	const actions = (
		<>
			<Button variant="outline" disabled={ retrying } onClick={ () => void openSite() }>
				{ __( 'Open site' ) }
			</Button>
			<Button loading={ retrying } onClick={ () => void startChat() }>
				{ __( 'Try again' ) }
			</Button>
		</>
	);
	const recovery = error ? (
		<>
			<Alert variant="destructive">
				<AlertTitle>{ error.title }</AlertTitle>
				<AlertDescription>{ error.message }</AlertDescription>
			</Alert>
			{ formActions ? createPortal( actions, formActions ) : null }
		</>
	) : null;
	const field = enabled ? (
		<Field className={ styles.brief } hidden={ ! providerConnected } inert={ ! providerConnected }>
			<FieldTitle className={ styles.briefTitle }>
				{ __( 'Start building with AI' ) }
				<span className={ styles.briefOptional }>{ __( '(optional)' ) }</span>
			</FieldTitle>
			<Composer
				ref={ composer }
				variant="field"
				ariaLabel={ __( 'Start building with AI' ) }
				draftKey={ briefDraftKey }
				busy={ busy }
				model={ model }
				provider={ provider }
				notice={ notice }
				onModelChange={ ( model, provider ) => setAiChoice( { model, provider } ) }
				onSend={ async () => undefined }
				onInterrupt={ async () => undefined }
				placeholder={
					source.type === 'blueprint'
						? __( 'Describe how you’d like to customize this Blueprint…' )
						: __( 'Describe your site, or add reference files…' )
				}
			/>
		</Field>
	) : null;
	return {
		field,
		recovery,
		hasCreatedSite: () => !! createdSiteId.current,
		capture: () => {
			brief.current = enabled ? composer.current?.getSubmission() ?? null : null;
			return !! brief.current;
		},
		finish: async ( siteId: string ) => {
			createdSiteId.current = siteId;
			if ( brief.current ) await startChat();
			else await openSite();
		},
	};
}
