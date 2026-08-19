import { decodePassword } from '@studio/common/lib/passwords';
import { __ } from '@wordpress/i18n';
import { Icon, moreVertical } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
import styles from './about-admin.module.css';
import type { SiteDetails } from '@/data/core';

function CopyText( {
	value,
	display,
	copyLabel,
	wrap,
	disabled,
}: {
	value: string;
	display: string;
	copyLabel: string;
	wrap?: boolean;
	disabled?: boolean;
} ) {
	const { copied, copy } = useCopyFeedback( value );
	const copiedLabel = __( 'Copied' );

	return (
		<>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ wrap ? `${ styles.copyText } ${ styles.wrap }` : styles.copyText }
							data-copied={ copied ? 'true' : undefined }
							aria-label={ copyLabel }
							disabled={ disabled }
							onClick={ copy }
						>
							{ display }
						</button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ copied ? copiedLabel : copyLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</>
	);
}

/**
 * Login state shared between the overflow menu (`LoginMenuButton`) and the
 * inline value line (`LoginValueLine`) — split so the caller can place the
 * button at the card's top-right independently of where the line renders.
 */
export function useAboutLogin( site: SiteDetails ) {
	// Checked-by-default toggle: the password stays hidden until the user opts in.
	const [ passwordHidden, setPasswordHidden ] = useState( true );
	// Resets the reveal state when the viewed site changes — this component
	// doesn't remount on site switches (the route only updates a param), so
	// without this a password revealed on one site stays revealed after
	// navigating to another. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
	const [ lastSiteId, setLastSiteId ] = useState( site.id );
	if ( site.id !== lastSiteId ) {
		setLastSiteId( site.id );
		setPasswordHidden( true );
	}

	return {
		username: site.adminUsername ?? 'admin',
		password: site.adminPassword ? decodePassword( site.adminPassword ) : '',
		email: site.adminEmail ?? 'admin@localhost.com',
		passwordHidden,
		setPasswordHidden,
	};
}

type AboutLoginState = ReturnType< typeof useAboutLogin >;

export function LoginMenuButton( {
	email,
	passwordHidden,
	setPasswordHidden,
	className,
}: Pick< AboutLoginState, 'email' | 'passwordHidden' | 'setPasswordHidden' > & {
	className?: string;
} ) {
	const { copied: emailCopied, copy: copyEmail } = useCopyFeedback( email );
	const copiedLabel = __( 'Copied' );

	return (
		<>
			<Menu.Root>
				<Tooltip.Root>
					<Menu.Trigger
						render={
							<Tooltip.Trigger
								render={
									<Button
										variant="minimal"
										tone="neutral"
										size="small"
										className={
											className ? `${ styles.menuTrigger } ${ className }` : styles.menuTrigger
										}
										aria-label={ __( 'Login options' ) }
									/>
								}
							>
								<Icon icon={ moreVertical } size={ 18 } />
							</Tooltip.Trigger>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ __( 'Login options' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
				<Menu.Popup side="bottom" align="end" className={ styles.menu }>
					{ /* Stays open on click, like the checkbox below, so the
					     "Copied" feedback is visible before the user dismisses it. */ }
					<Menu.Item
						onClick={ copyEmail }
						closeOnClick={ false }
						aria-label={ emailCopied ? copiedLabel : __( 'Copy email' ) }
					>
						<span className={ styles.menuItemText } aria-hidden="true">
							<span>{ emailCopied ? copiedLabel : __( 'Copy email' ) }</span>
							<span className={ styles.menuItemSub }>{ email }</span>
						</span>
					</Menu.Item>
					<Menu.CheckboxItem
						checked={ passwordHidden }
						onCheckedChange={ setPasswordHidden }
						closeOnClick={ false }
					>
						{ __( 'Hide password' ) }
					</Menu.CheckboxItem>
				</Menu.Popup>
			</Menu.Root>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ emailCopied ? copiedLabel : '' }
			</span>
		</>
	);
}

export function LoginValueLine( {
	username,
	password,
	passwordHidden,
}: Pick< AboutLoginState, 'username' | 'password' | 'passwordHidden' > ) {
	return (
		<div className={ passwordHidden ? styles.value : `${ styles.value } ${ styles.stacked }` }>
			<div className={ styles.usernameRow }>
				<CopyText
					value={ username }
					display={ username }
					copyLabel={ __( 'Copy admin username' ) }
				/>
				<span className={ styles.sep } aria-hidden="true">
					:
				</span>
				{ passwordHidden ? (
					<CopyText
						value={ password }
						display={ '•'.repeat( 8 ) }
						copyLabel={ __( 'Copy admin password' ) }
						disabled={ ! password }
					/>
				) : null }
			</div>
			{ passwordHidden ? null : (
				<CopyText
					value={ password }
					display={ password || '—' }
					copyLabel={ __( 'Copy admin password' ) }
					wrap
					disabled={ ! password }
				/>
			) }
		</div>
	);
}
