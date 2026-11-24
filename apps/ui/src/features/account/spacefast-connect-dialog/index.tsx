import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Spinner,
} from '@studio/ds';
import { useOffline } from '@studio/ds/hooks';
import { DuplicateIcon, ExternalLinkIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { ProviderLogo } from '@/features/account/provider-logo';
import styles from './style.module.css';
import type { PendingConnect } from '@studio/providers';
import type { ReactNode } from 'react';

function SignInCode( { code }: { code: string } ) {
	const { copied, copy } = useCopyText( code );
	return (
		<div className={ styles.codeRow }>
			<code className={ styles.code }>{ code }</code>
			<Button variant="outline" size="sm" onClick={ copy }>
				{ copied ? <CheckIcon /> : <DuplicateIcon /> }
				<span aria-live="polite">{ copied ? __( 'Copied' ) : __( 'Copy code' ) }</span>
			</Button>
		</div>
	);
}

export function SpacefastConnectDialog( {
	open,
	autoOpen = false,
	pending,
	isPending,
	error,
	icon,
	onRetry,
	onClose,
}: {
	open: boolean;
	autoOpen?: boolean;
	pending: PendingConnect | null;
	isPending: boolean;
	error?: string;
	icon?: ReactNode;
	onRetry: () => void;
	onClose: () => void;
} ) {
	const connector = useConnector();
	const offline = useOffline();
	const [ opened, setOpened ] = useState< PendingConnect | null >( null );
	const attempted = useRef< PendingConnect | null >( null );
	const code = pending?.code;
	const url = pending?.url;
	const waiting = !! pending && pending === opened;
	const openSpacefast = useCallback(
		( attempt: PendingConnect ) => {
			void connector
				.openExternalUrl( attempt.url )
				.then( () => setOpened( attempt ) )
				.catch( ( openError ) => {
					toast.error( __( 'Could not open Spacefast' ), {
						description: errorMessage( openError ),
					} );
				} );
		},
		[ connector ]
	);
	useEffect( () => {
		if ( ! open || ! pending ) {
			attempted.current = null;
			return;
		}
		if ( ! autoOpen || offline || attempted.current === pending ) return;
		attempted.current = pending;
		openSpacefast( pending );
	}, [ open, autoOpen, pending, offline, openSpacefast ] );

	return (
		<Dialog open={ open } onOpenChange={ ( isOpen ) => ! isOpen && onClose() }>
			<DialogContent
				className={ styles.dialog }
				layout="compact"
				finalFocus={ false }
				motion="none"
			>
				<DialogHeader>
					<DialogTitle className={ styles.title }>
						{ icon ?? <ProviderLogo provider="spacefast" /> }
						{ __( 'Connect to Spacefast' ) }
					</DialogTitle>
					{ url ? (
						<DialogDescription>
							{ code
								? autoOpen
									? __( 'Make sure the codes match in your browser, then approve the connection.' )
									: __(
											'Open Spacefast in your browser. Make sure the codes match, then approve the connection.'
									  )
								: __( 'Approve the connection in your browser.' ) }
						</DialogDescription>
					) : null }
				</DialogHeader>
				{ error ? (
					<p className={ styles.error } role="alert">
						{ error }
					</p>
				) : code ? (
					<SignInCode key={ code } code={ code } />
				) : isPending && ! url ? (
					<div className={ styles.status } role="status">
						<Spinner aria-hidden="true" />
						{ __( 'Getting your sign-in code…' ) }
					</div>
				) : null }
				{ url || error ? (
					<DialogFooter className={ styles.footer }>
						{ url ? (
							<>
								<div className={ styles.status } role="status">
									{ waiting && (
										<>
											<Spinner aria-hidden="true" />
											{ __( 'Waiting for approval…' ) }
										</>
									) }
								</div>
								<Button
									variant="accent"
									disabled={ offline }
									onClick={ () => pending && openSpacefast( pending ) }
								>
									{ __( 'Open Spacefast' ) }
									<ExternalLinkIcon data-icon="inline-end" />
								</Button>
							</>
						) : (
							<Button variant="accent" disabled={ offline } onClick={ onRetry }>
								{ __( 'Try again' ) }
							</Button>
						) }
					</DialogFooter>
				) : null }
			</DialogContent>
		</Dialog>
	);
}
