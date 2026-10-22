import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { LearnMoreLink } from '@/components/learn-more';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { SettingsGroup, SettingsRow, SettingsToggle } from './rows';
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

	// A standalone (curl) install is never touched by the app, so the toggle
	// is read-only with a tooltip pointing at `studio uninstall`.
	const externallyManaged = saved.studioCliExternallyManaged;
	const checked = pending ?? saved.studioCliInstalled;

	const handleChange = ( studioCliInstalled: boolean ) => {
		if ( externallyManaged ) {
			return;
		}
		setPending( studioCliInstalled );
		savePreferences.mutate( { studioCliInstalled }, { onSettled: () => setPending( null ) } );
	};

	const toggle = (
		<SettingsToggle
			label={ __( 'Studio CLI for terminal' ) }
			checked={ checked }
			disabled={ savePreferences.isPending || externallyManaged }
			onChange={ handleChange }
		/>
	);

	return (
		<SettingsGroup title={ __( 'Studio CLI' ) }>
			<SettingsRow
				title={ __( 'Studio CLI for terminal' ) }
				description={
					<>
						{ __( 'Use the studio command in any terminal to manage sites and run WP-CLI.' ) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsCli" />
					</>
				}
				error={
					savePreferences.isError
						? __( 'An error occurred while updating the Studio CLI. Please try again.' )
						: undefined
				}
			>
				{ externallyManaged ? (
					// The default open delay reads as unresponsive on a disabled
					// control, so this tooltip gets its own faster provider.
					<TooltipProvider delay={ 200 }>
						<Tooltip>
							<TooltipTrigger
								render={ <span className={ styles.cliToggleTrigger }>{ toggle }</span> }
							/>
							<TooltipContent className={ styles.cliTooltip }>
								{ __(
									'This studio command was installed with the standalone CLI installer, so Studio can’t manage it. Run studio uninstall in a terminal to remove it.'
								) }
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : (
					toggle
				) }
			</SettingsRow>
		</SettingsGroup>
	);
}
