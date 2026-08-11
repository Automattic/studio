import styles from './style.module.css';

/**
 * Transparent full-window shield that blocks pointer interaction while a
 * long-running action (site creation, connect-and-pull) finishes. Pair it
 * with disabled/loading states on the triggering button — it deliberately
 * covers everything, including the onboarding close button, so a stray
 * click can't interrupt the work mid-flight.
 */
export function BusyOverlay( { active }: { active: boolean } ) {
	if ( ! active ) {
		return null;
	}
	return <div aria-hidden="true" className={ styles.overlay } />;
}
