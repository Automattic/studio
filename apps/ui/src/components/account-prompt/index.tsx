import { __ } from '@wordpress/i18n';
import { Dialog, VisuallyHidden } from '@wordpress/ui';
import { useId, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { useLogin } from '@/data/queries/use-auth-user';
import { useOffline } from '@/hooks/use-offline';
import site1 from './assets/site-1.png';
import site2 from './assets/site-2.png';
import site3 from './assets/site-3.png';
import styles from './style.module.css';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

export const previewSiteImage = site2;

// Asks a signed-out user to create a WordPress.com account or log in before
// something that needs one, like publishing or sharing.
export function AccountPrompt( {
	title,
	description,
	descriptionId,
	source,
	onCreateAccount,
}: {
	title: string;
	description: string;
	descriptionId?: string;
	source: TracksAuthSource;
	onCreateAccount?: () => void;
} ) {
	const offline = useOffline();
	const login = useLogin( { source } );
	const signup = useLogin( { signup: true, source } );
	const pending = login.isPending || signup.isPending;
	const error = login.error ?? signup.error;
	return (
		<div className={ styles.body }>
			<div aria-hidden="true" className={ styles.illustration }>
				<span className={ styles.cardStart } style={ { backgroundImage: `url(${ site1 })` } } />
				<span className={ styles.cardEnd } style={ { backgroundImage: `url(${ site3 })` } } />
				<span className={ styles.cardCenter } style={ { backgroundImage: `url(${ site2 })` } } />
			</div>
			<h2 className={ styles.title }>{ title }</h2>
			<p id={ descriptionId } className={ styles.description }>
				{ offline
					? __( 'Connect to the internet to create an account or log in.' )
					: pending
					? __( 'Finish creating your account or logging in to WordPress.com in your browser.' )
					: description }
			</p>
			{ error ? (
				<p role="alert" className={ styles.error }>
					{ error instanceof Error ? error.message : String( error ) }
				</p>
			) : null }
			<Button
				size="lg"
				className={ styles.createAccount }
				disabled={ offline || pending }
				loading={ signup.isPending }
				onClick={ () => {
					onCreateAccount?.();
					signup.mutate();
				} }
			>
				{ __( 'Create account' ) }
			</Button>
			<Button
				variant="inline-text"
				size="inline"
				className={ styles.logIn }
				disabled={ offline || pending }
				loading={ login.isPending }
				onClick={ () => login.mutate() }
			>
				{ __( 'Log in to WordPress.com' ) }
			</Button>
		</div>
	);
}

export function AccountPromptDialog( {
	open,
	onOpenChange,
	finalFocus,
	...prompt
}: Parameters< typeof AccountPrompt >[ 0 ] & {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	finalFocus?: RefObject< HTMLElement | null >;
} ) {
	const descriptionId = useId();
	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup
				size="small"
				className={ styles.popup }
				aria-describedby={ descriptionId }
				finalFocus={ finalFocus }
			>
				<Dialog.Header className={ styles.header }>
					<VisuallyHidden>
						<Dialog.Title>{ prompt.title }</Dialog.Title>
					</VisuallyHidden>
					<Dialog.CloseIconButton />
				</Dialog.Header>
				<AccountPrompt { ...prompt } descriptionId={ descriptionId } />
			</Dialog.Popup>
		</Dialog.Root>
	);
}
