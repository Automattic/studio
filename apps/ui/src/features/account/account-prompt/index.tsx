import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useId, type RefObject } from 'react';
import { useLogin } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import {
	StudioIcon,
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	VisuallyHidden,
} from '@/lib/ui';
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
	onContinue,
	onSkip,
	busy,
	disabled,
	flush,
	className,
}: {
	title: string;
	description: string;
	descriptionId?: string;
	source: TracksAuthSource;
	onCreateAccount?: () => void;
	onContinue?: () => void;
	onSkip?: () => void;
	busy?: boolean;
	disabled?: boolean;
	/** Drops the offsets that space it inside a dialog, for a container that spaces it already. */
	flush?: boolean;
	className?: string;
} ) {
	const offline = useOffline();
	const login = useLogin( { source } );
	const signup = useLogin( { signup: true, source } );
	const authenticating = login.isPending || signup.isPending;
	const pending = authenticating || busy || disabled;
	const error = login.error ?? signup.error;
	return (
		<div className={ clsx( styles.body, flush && styles.flush, className ) }>
			<div aria-hidden="true" className={ styles.illustration }>
				<span className={ styles.cardStart } style={ { backgroundImage: `url(${ site1 })` } } />
				<span className={ styles.cardEnd } style={ { backgroundImage: `url(${ site3 })` } } />
				<span className={ styles.cardCenter } style={ { backgroundImage: `url(${ site2 })` } } />
				<StudioIcon className={ styles.studioIcon } />
			</div>
			<h2 className={ styles.title }>{ title }</h2>
			<p id={ descriptionId } className={ styles.description }>
				{ offline && ! onContinue
					? __( 'Connect to the internet to create an account or log in.' )
					: description }
			</p>
			{ error ? (
				<p role="alert" className={ styles.error }>
					{ error instanceof Error ? error.message : String( error ) }
				</p>
			) : null }
			<div className={ styles.actions }>
				<Button
					size="lg"
					disabled={ ( ! onContinue && offline ) || pending }
					loading={ signup.isPending || busy }
					onClick={ () => {
						if ( onContinue ) {
							onContinue();
						} else {
							onCreateAccount?.();
							signup.mutate();
						}
					} }
				>
					{ onContinue
						? __( 'Continue' )
						: onSkip
						? __( 'Continue with WordPress.com' )
						: __( 'Create account' ) }
				</Button>
				{ ( onSkip || ! onContinue ) && (
					<p className={ styles.loginPrompt }>
						{ ! onSkip && <>{ __( 'Already have an account?' ) } </> }
						<Button
							className={ styles.login }
							variant="inline-text"
							size="inline"
							disabled={ onSkip ? busy || disabled : offline || pending }
							focusableWhenDisabled={ ! onSkip && login.isPending }
							onClick={ () => {
								if ( onSkip ) {
									onSkip();
								} else {
									login.mutate();
								}
							} }
						>
							{ onSkip ? __( 'Not now' ) : __( 'Log in' ) }
						</Button>
					</p>
				) }
			</div>
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
		<Dialog open={ open } onOpenChange={ onOpenChange }>
			<DialogContent aria-describedby={ descriptionId } finalFocus={ finalFocus }>
				<DialogHeader>
					<VisuallyHidden>
						<DialogTitle>{ prompt.title }</DialogTitle>
					</VisuallyHidden>
				</DialogHeader>
				<AccountPrompt { ...prompt } descriptionId={ descriptionId } />
			</DialogContent>
		</Dialog>
	);
}
