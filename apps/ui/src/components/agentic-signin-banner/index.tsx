import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { EmptyBackground } from '@/ui-classic/components/session-view/empty-background';
import styles from './style.module.css';
import type { AgenticFeatureReason } from '@/data/queries/use-agentic-features';

const TAGLINE_INTERVAL_MS = 4000;

// The illustrated, collapsible sign-in band pinned to the bottom of the site overview.
export function AgenticSigninBanner() {
	const { enabled, reason } = useAgenticFeatures();
	const login = useLogin();
	const navigate = useNavigate();
	const sidebarCollapsed = useSidebarCollapsed();
	const [ minimized, setMinimized ] = useState( false );
	const [ taglineIndex, setTaglineIndex ] = useState( 0 );

	const taglines = [
		__( 'Let Studio code it for you' ),
		__( 'Share a preview online' ),
		__( 'Push to your live site' ),
		__( 'Build a theme or plugin' ),
	];
	const taglineCount = taglines.length;

	// `authenticate()` resolves when the browser opens, not when OAuth
	// completes, so a finished login only surfaces here as a signed-out →
	// enabled transition. Send the user back to the chat screen when it does.
	const previousReasonRef = useRef< AgenticFeatureReason >( null );
	useEffect( () => {
		const previous = previousReasonRef.current;
		previousReasonRef.current = reason;
		if ( enabled && previous === 'signed-out' ) {
			void navigate( { to: '/' } );
		}
	}, [ enabled, reason, navigate ] );

	// Rotate the tagline while collapsed.
	useEffect( () => {
		if ( ! minimized ) {
			return;
		}
		const id = window.setInterval( () => {
			setTaglineIndex( ( index ) => ( index + 1 ) % taglineCount );
		}, TAGLINE_INTERVAL_MS );
		return () => window.clearInterval( id );
	}, [ minimized, taglineCount ] );

	if ( reason !== 'signed-out' ) {
		return null;
	}

	const loginButton = (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<Button
						type="button"
						variant="solid"
						tone="neutral"
						size="small"
						loading={ login.isPending }
						onClick={ () => login.mutate() }
					>
						{ minimized ? __( 'Log in' ) : __( 'Log in with WordPress.com' ) }
					</Button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ minimized ? __( 'Log in to WordPress.com' ) : __( 'Opens your browser to log in' ) }
			</Tooltip.Popup>
		</Tooltip.Root>
	);

	// Hidden: a rotating tagline next to the log-in button, pinned clear of the
	// preview toggle and above the footer blur.
	if ( minimized ) {
		return (
			<section
				className={ clsx( styles.root, styles.minimized ) }
				aria-label={ __( 'Log in to Studio' ) }
			>
				<span key={ taglineIndex } className={ styles.tagline } aria-hidden="true">
					{ taglines[ taglineIndex ] }
				</span>
				{ loginButton }
			</section>
		);
	}

	return (
		<section
			className={ clsx( styles.root, sidebarCollapsed && styles.collapsed ) }
			aria-label={ __( 'Log in to Studio' ) }
		>
			<DotGrid className={ styles.grid } opacity={ 0.35 } />
			<ProgressiveBlur direction="down" fadeToSurface className={ styles.topBlur } />
			<div className={ styles.lockup }>
				<div className={ styles.mark } aria-hidden="true">
					<EmptyBackground />
				</div>
				<div className={ styles.copy }>
					<h2 className={ styles.heading }>{ __( 'Let Studio code it for you' ) }</h2>
					<p className={ styles.subline }>
						{ __(
							'An AI powered WordPress expert that can build a site, theme, or plugin, and help you share and publish.'
						) }
					</p>
					<div className={ styles.actions }>
						{ loginButton }
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							size="small"
							onClick={ () => setMinimized( true ) }
						>
							{ __( 'Hide' ) }
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}

// A compact inline notice (no route-aware redirect) for surfaces that keep the
// prompt in the content flow and must stay put once the user signs in — e.g. the
// Settings Usage panel.
export function SigninNotice() {
	const login = useLogin();

	return (
		<section className={ styles.notice } aria-label={ __( 'Log in to Studio' ) }>
			<div className={ styles.noticeText }>
				<h2 className={ styles.noticeHeading }>{ __( 'Log in to do more with Studio' ) }</h2>
				<ul className={ styles.noticeBenefits }>
					<li>{ __( 'Chat with a WordPress expert that builds and edits your site for you' ) }</li>
					<li>{ __( 'Share your work instantly with preview links' ) }</li>
					<li>{ __( "Publish to a real WordPress.com site when you're ready" ) }</li>
				</ul>
			</div>
			<div className={ styles.noticeActions }>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
			</div>
		</section>
	);
}
