import { FormToggle } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useState } from 'react';
import { LearnMoreLink } from '@/components/learn-more';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import styles from './style.module.css';

export function StudioCliSection() {
	const { data: appGlobals } = useAppGlobals();
	const { data: saved } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	// Optimistic toggle state while an install/uninstall is in flight. Cleared
	// on settle: on success the query cache already holds the new value, on
	// failure the toggle falls back to the saved state.
	const [ pending, setPending ] = useState< boolean | null >( null );

	// The CLI installer only exists in the desktop app, and Windows Store
	// builds can't write to PATH.
	if ( ! appGlobals || appGlobals.platform === 'browser' || appGlobals.isWindowsStore || ! saved ) {
		return null;
	}

	const checked = pending ?? saved.studioCliInstalled;

	const handleChange = ( studioCliInstalled: boolean ) => {
		setPending( studioCliInstalled );
		savePreferences.mutate( { studioCliInstalled }, { onSettled: () => setPending( null ) } );
	};

	return (
		<section className={ styles.preferenceSectionGroup }>
			<div className={ styles.cliHeader }>
				<h2 className={ clsx( styles.preferenceSectionHeading, styles.cliHeading ) }>
					{ __( 'Studio CLI' ) }
				</h2>
				<FormToggle
					id="studio-cli-toggle"
					aria-label={ __( 'Studio CLI for terminal' ) }
					checked={ checked }
					disabled={ savePreferences.isPending }
					onChange={ ( event ) => handleChange( event.target.checked ) }
				/>
			</div>
			{ savePreferences.isError ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while updating the Studio CLI. Please try again.' ) }
				</div>
			) : null }
			<p className={ styles.cliDescription }>
				{ __( 'Use the studio command in any terminal to manage sites and run WP-CLI.' ) }{ ' ' }
				<LearnMoreLink docsLinksKey="docsCli" />
			</p>
		</section>
	);
}
