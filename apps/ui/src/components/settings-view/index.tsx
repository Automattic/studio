import { getLocalizedLink, REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { supportedLocaleNames } from '@studio/common/lib/locale';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AccountSection } from './account-section';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import { SettingsGroup, SettingsRow, SettingsSelect, SettingsToggle } from './rows';
import { StudioCliSection } from './studio-cli-section';
import styles from './style.module.css';
import { WapuuScore } from './wapuu-score';
import type { PreferencesFormData } from './preferences';
import type {
	InstalledApps,
	QuitSitesBehavior,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
} from '@/data/core';

// No "unset" option: the main process resolves a fallback for never-chosen
// editor/terminal prefs (matching the legacy UI), so an explicit clear can't
// round-trip. The select shows its placeholder when nothing is installed.
function editorElements( installedApps: InstalledApps | undefined ) {
	return SUPPORTED_EDITORS.filter( ( editor ) => ! installedApps || installedApps[ editor ] ).map(
		( editor ) => ( {
			value: editor,
			label: supportedEditorConfig[ editor ].label(),
		} )
	);
}

function terminalElements( installedApps: InstalledApps | undefined ) {
	return SUPPORTED_TERMINALS.filter(
		( terminal ) => ! installedApps || installedApps[ terminal ]
	).map( ( terminal ) => ( {
		value: terminal,
		label: terminalConfig[ terminal ].name(),
	} ) );
}

const QUIT_SITES_BEHAVIOR_ELEMENTS: {
	value: QuitSitesBehavior | typeof UNSET;
	label: string;
}[] = [
	{ value: UNSET, label: __( 'Ask every time' ) },
	{ value: 'leave-running', label: __( 'Keep sites running' ) },
	{ value: 'stop-and-auto-start', label: __( 'Stop, restart on next launch' ) },
	{ value: 'stop', label: __( 'Stop sites' ) },
];

const LOCALE_ELEMENTS: { value: SupportedLocale; label: string }[] = Object.entries(
	supportedLocaleNames
).map( ( [ value, label ] ) => ( { value: value as SupportedLocale, label } ) );

function DefaultSiteDirectoryRow( { value, onSelect }: { value: string; onSelect?: () => void } ) {
	const title = __( 'Default directory' );
	const description = __( 'The folder where Studio creates new sites.' );
	// Without a native folder picker (the browser), the path is shown, not edited.
	if ( ! onSelect ) {
		return (
			<SettingsRow title={ title } description={ description } stacked>
				<span className={ styles.pathPickerValue }>{ value }</span>
			</SettingsRow>
		);
	}
	return (
		<SettingsRow title={ title } description={ description } stacked>
			<button
				type="button"
				className={ styles.pathPickerButton }
				aria-label={
					value
						? sprintf( __( 'Default directory: %s. Choose a different folder.' ), value )
						: __( 'Choose a default directory' )
				}
				onClick={ onSelect }
			>
				<span className={ value ? styles.pathPickerValue : styles.pathPickerPlaceholder }>
					{ value || __( 'Choose a folder…' ) }
				</span>
			</button>
		</SettingsRow>
	);
}

function PreferencesPanel( {
	data,
	installedApps,
	saveError,
	onDefaultSiteDirectorySelect,
	onChange,
}: {
	data: PreferencesFormData;
	installedApps: InstalledApps | undefined;
	saveError: boolean;
	onDefaultSiteDirectorySelect?: () => void;
	onChange: ( update: Partial< PreferencesFormData > ) => void;
} ) {
	const connector = useConnector();
	const locale = useUserLocale();
	return (
		<div className={ styles.preferencesPanel }>
			<AccountSection />
			{ saveError ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while saving settings. Please try again.' ) }
				</div>
			) : null }
			<SettingsGroup>
				<SettingsRow
					title={ __( 'Language' ) }
					description={ __( 'Default language for Studio.' ) }
				>
					<SettingsSelect
						label={ __( 'Language' ) }
						value={ data.locale }
						options={ LOCALE_ELEMENTS }
						onChange={ ( locale ) => onChange( { locale } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Code editor' ) }
					description={ __( 'The default code editor for your sites.' ) }
				>
					<SettingsSelect< SupportedEditor | typeof UNSET >
						label={ __( 'Code editor' ) }
						value={ data.editor }
						options={ editorElements( installedApps ) }
						onChange={ ( editor ) => onChange( { editor } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Terminal' ) }
					description={ __( 'The default terminal for your sites.' ) }
				>
					<SettingsSelect< SupportedTerminal | typeof UNSET >
						label={ __( 'Terminal' ) }
						value={ data.terminal }
						options={ terminalElements( installedApps ) }
						onChange={ ( terminal ) => onChange( { terminal } ) }
					/>
				</SettingsRow>
				<DefaultSiteDirectoryRow
					value={ data.defaultSiteDirectory }
					onSelect={ onDefaultSiteDirectorySelect }
				/>
				<SettingsRow
					title={ __( 'Improve Studio for everyone' ) }
					description={ __( 'Share anonymous usage statistics to improve Studio.' ) }
				>
					<SettingsToggle
						label={ __( 'Improve Studio for everyone' ) }
						checked={ data.analyticsEnabled }
						onChange={ ( analyticsEnabled ) => onChange( { analyticsEnabled } ) }
					/>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title={ __( 'Interface' ) }>
				<SettingsRow
					title={ __( 'When Studio quits' ) }
					description={ __( 'Choose what happens to running sites when you quit Studio.' ) }
				>
					<SettingsSelect< QuitSitesBehavior | typeof UNSET >
						label={ __( 'When Studio quits' ) }
						value={ data.quitSitesBehavior }
						options={ QUIT_SITES_BEHAVIOR_ELEMENTS }
						onChange={ ( quitSitesBehavior ) => onChange( { quitSitesBehavior } ) }
					/>
				</SettingsRow>
			</SettingsGroup>
			<StudioCliSection />
			<WapuuScore />
			<SettingsGroup title={ __( 'Help' ) }>
				<SettingsRow
					title={ __( 'Documentation' ) }
					description={ __( 'Guides for building and managing sites with Studio.' ) }
				>
					<Button
						variant="outline"
						tone="neutral"
						size="compact"
						onClick={ () =>
							void connector.openExternalUrl( getLocalizedLink( locale, 'docsStudio' ) )
						}
					>
						{ __( 'Open docs' ) }
					</Button>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Report an issue' ) }
					description={ __( 'Report a bug or request a feature.' ) }
				>
					<Button
						variant="outline"
						tone="neutral"
						size="compact"
						onClick={ () => void connector.openExternalUrl( REPORT_ISSUE_URL ) }
					>
						{ __( 'Report' ) }
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}

function usePreferencesForm() {
	const { data: saved, isError: loadFailed } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();

	const [ data, setData ] = useState< PreferencesFormData | null >( null );
	useEffect( () => {
		if ( saved ) {
			setData( toPreferencesFormData( saved ) );
		}
	}, [ saved ] );

	// Settings save on change: reflect the update in the form state for
	// instant feedback, then persist it right away.
	const handleChange = useCallback(
		( update: Partial< PreferencesFormData > ) => {
			setData( ( prev ) => ( prev ? { ...prev, ...update } : prev ) );

			const patch = toPreferencesPatch( update );
			if ( Object.keys( patch ).length === 0 ) {
				return;
			}
			// Tag only the analytics toggle with its surface for Tracks.
			const withSource =
				'analyticsEnabled' in patch
					? { ...patch, source: { surface: 'settings' } as const }
					: patch;
			savePreferences.mutate( withSource, {
				onSuccess: async () => {
					if ( 'locale' in patch ) {
						// Translations are loaded once at bootstrap; the rest of the
						// app imports `__` from `@wordpress/i18n` directly and doesn't
						// subscribe to locale changes. Reload the window so every
						// string re-renders in the new language. The persister is
						// throttled (~1s), so drop the persisted cache first — the
						// next mount then refetches preferences from the main
						// process, which has the newly saved locale.
						await persister.removeClient();
						// Give the select popup a beat to finish closing — an
						// immediate reload freezes its exit animation mid-flight
						// and reads as lag.
						window.setTimeout( () => window.location.reload(), 250 );
					}
				},
				onError: () => {
					if ( saved ) {
						setData( toPreferencesFormData( saved ) );
					}
				},
			} );
		},
		[ saved, savePreferences ]
	);

	return { data, handleChange, saveError: savePreferences.isError, loadFailed };
}

function PreferencesState( { loadFailed }: { loadFailed: boolean } ) {
	return (
		<div className={ styles.state }>
			{ loadFailed
				? __( "Couldn't load your settings. Close Settings and reopen it to try again." )
				: __( 'Loading…' ) }
		</div>
	);
}

export function GeneralSettings() {
	const connector = useConnector();
	const { data: installedApps } = useInstalledApps();
	const { data, handleChange, saveError, loadFailed } = usePreferencesForm();
	if ( ! data ) {
		return <PreferencesState loadFailed={ loadFailed } />;
	}
	const selectDefaultDirectory = async () => {
		const directory = await connector.selectDefaultSiteDirectory( data.defaultSiteDirectory );
		if ( directory ) {
			handleChange( { defaultSiteDirectory: directory } );
		}
	};
	return (
		<PreferencesPanel
			data={ data }
			installedApps={ installedApps }
			saveError={ saveError }
			onDefaultSiteDirectorySelect={
				connector.capabilities.nativeFolderPicker ? () => void selectDefaultDirectory() : undefined
			}
			onChange={ handleChange }
		/>
	);
}

export { AiPanel } from './ai-panel';
export { AppearanceSettings } from './appearance-settings';
export { KeyboardPanel } from './keyboard-panel';
export { McpPanel } from './mcp-panel';
export { SkillsPanel } from './skills-panel';
export { UsagePanel } from './usage-panel';
