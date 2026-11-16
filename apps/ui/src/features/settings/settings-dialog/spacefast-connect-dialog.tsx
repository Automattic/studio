import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { ProviderLogo } from '@/features/settings/settings-view/provider-logo';
import { useOffline } from '@/lib/hooks';
import { DuplicateIcon, ExternalLinkIcon } from '@/lib/icons';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Spinner,
} from '@/lib/ui';
import styles from './spacefast-connect-dialog.module.css';
import type { PendingConnect } from '@studio/providers';

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
	pending,
	isPending,
	error,
	onRetry,
	onClose,
}: {
	open: boolean;
	pending: PendingConnect | null;
	isPending: boolean;
	error?: string;
	onRetry: () => void;
	onClose: () => void;
} ) {
	const connector = useConnector();
	const offline = useOffline();
	const [ opened, setOpened ] = useState< PendingConnect | null >( null );
	const code = pending?.code;
	const url = pending?.url;
	const waiting = !! pending && pending === opened;

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
						<ProviderLogo provider="spacefast" />
						{ __( 'Connect to Spacefast' ) }
					</DialogTitle>
					{ url ? (
						<DialogDescription>
							{ code
								? __(
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
									onClick={ () => {
										void connector
											.openExternalUrl( url )
											.then( () => setOpened( pending ) )
											.catch( ( error ) => {
												toast.error( __( 'Could not open Spacefast' ), {
													description: errorMessage( error ),
												} );
											} );
									} }
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
