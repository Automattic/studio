import { getLocalizedLink, REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { supportedLocaleNames } from '@studio/common/lib/locale';
import { SUPPORTED_BROWSERS, browserConfig } from '@studio/common/lib/user-settings/browser';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import {
	getColorTint,
	INTERFACE_PREFERENCE_DEFAULTS,
} from '@studio/common/lib/user-settings/preferences';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import {
	useAgentInstructionsEnabled,
	useSetAgentInstructionsEnabled,
} from '@/data/queries/use-agent-instructions';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useResetAppearance, useResetInterface } from '@/data/queries/use-reset-interface';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { hasCustomPanelLayout } from '@/data/resizable-panels';
import { ExternalLinkIcon } from '@/lib/icons';
import { isDefaultColorTint } from '@/lib/theme';
import { Input, Button } from '@/lib/ui';
import { AccountSection } from './account-section';
import { ColorTintSettings } from './color-tint-settings';
import { InstructionsEditor } from './instructions-editor';
import { NewSiteBehaviorRow } from './new-site-behavior-row';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import {
	SettingsGroup,
	SettingsLoadState,
	SettingsRow,
	SettingsSelect,
	SettingsToggle,
} from './rows';
import { SidebarSettings } from './sidebar-settings';
import { StudioCliSection } from './studio-cli-section';
import styles from './style.module.css';
import { WapuuScore } from './wapuu-score';
import type { PreferencesFormData } from './preferences';
import type {
	ColorScheme,
	InstalledApps,
	QuitSitesBehavior,
	SupportedLocale,
	UserPreferences,
} from '@/data/core';

// "System default" first, then the installed apps and the saved one, even if it's gone.
function appElements< TApp extends keyof InstalledApps >(
	apps: readonly TApp[],
	installedApps: InstalledApps | undefined,
	saved: TApp | typeof UNSET,
	label: ( app: TApp ) => string
) {
	return [
		{ value: UNSET, label: __( 'System default' ) },
		...apps
			.filter( ( app ) => ! installedApps || installedApps[ app ] || app === saved )
			.map( ( app ) => ( { value: app, label: label( app ) } ) ),
	];
}

const getColorSchemeElements = (): { value: ColorScheme; label: string }[] => [
	{ value: 'system', label: __( 'System' ) },
	{ value: 'light', label: __( 'Light' ) },
	{ value: 'dark', label: __( 'Dark' ) },
];

const getQuitSitesBehaviorElements = (): {
	value: QuitSitesBehavior | typeof UNSET;
	label: string;
}[] => [
	{ value: UNSET, label: __( 'Ask every time' ) },
	{ value: 'leave-running', label: __( 'Keep sites running' ) },
	{ value: 'stop-and-auto-start', label: __( 'Stop, restart on next launch' ) },
	{ value: 'stop', label: __( 'Stop sites' ) },
];

const LOCALE_ELEMENTS: { value: SupportedLocale; label: string }[] = Object.entries(
	supportedLocaleNames
).map( ( [ value, label ] ) => ( { value: value as SupportedLocale, label } ) );

function DefaultSiteDirectoryRow( {
	value,
	onSelect,
	onSave,
}: {
	value: string;
	onSelect?: () => void;
	onSave: ( directory: string ) => void;
} ) {
	const title = __( 'Default directory' );
	const description = __( 'The folder where WordPress Studio creates new sites.' );
	const [ draft, setDraft ] = useState< string | null >( null );
	// Without a native folder picker (the browser), the path is typed in.
	if ( ! onSelect ) {
		const directory = draft?.trim();
		return (
			<SettingsRow title={ title } description={ description } stacked>
				<form
					className={ styles.pathForm }
					onSubmit={ ( event ) => {
						event.preventDefault();
						if ( directory && directory !== value ) {
							onSave( directory );
						}
					} }
				>
					<Input
						aria-label={ title }
						value={ draft ?? value }
						onChange={ ( event ) => setDraft( event.target.value ) }
					/>
					<Button type="submit" variant="outline" disabled={ ! directory || directory === value }>
						{ __( 'Save' ) }
					</Button>
				</form>
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

// True when every interface preference and the panel layout are at their defaults.
function isDefaultInterface( saved: UserPreferences ) {
	return (
		! hasCustomPanelLayout() &&
		Object.entries( INTERFACE_PREFERENCE_DEFAULTS ).every(
			( [ key, value ] ) => ( saved[ key as keyof UserPreferences ] ?? value ) === value
		)
	);
}

function PreferencesPanel( {
	data,
	installedApps,
	saveError,
	interfaceIsDefault,
	onDefaultSiteDirectorySelect,
	onChange,
	onResetInterface,
}: {
	data: PreferencesFormData;
	installedApps: InstalledApps | undefined;
	saveError: boolean;
	interfaceIsDefault: boolean;
	onDefaultSiteDirectorySelect?: () => void;
	onChange: ( update: Partial< PreferencesFormData > ) => void;
	onResetInterface: () => void;
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
			<SettingsGroup title={ __( 'Application' ) }>
				<SettingsRow
					title={ __( 'Language' ) }
					description={ __( 'Default language for WordPress Studio.' ) }
				>
					<SettingsSelect
						label={ __( 'Language' ) }
						value={ data.locale }
						options={ LOCALE_ELEMENTS }
						onChange={ ( locale ) => onChange( { locale } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Default code editor' ) }
					description={ __( 'The default code editor for your sites.' ) }
				>
					<SettingsSelect
						label={ __( 'Default code editor' ) }
						value={ data.editor }
						options={ appElements( SUPPORTED_EDITORS, installedApps, data.editor, ( editor ) =>
							supportedEditorConfig[ editor ].label()
						) }
						onChange={ ( editor ) => onChange( { editor } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Default browser' ) }
					description={ __( 'The browser used to open your sites, WP Admin, and phpMyAdmin.' ) }
				>
					<SettingsSelect
						label={ __( 'Default browser' ) }
						value={ data.browser }
						options={ [
							{ value: UNSET, label: __( 'System default' ) },
							...SUPPORTED_BROWSERS.filter(
								( browser ) => installedApps?.[ browser ] || browser === data.browser
							).map( ( browser ) => ( { value: browser, label: browserConfig[ browser ].name } ) ),
						] }
						onChange={ ( browser ) => onChange( { browser } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Default terminal app' ) }
					description={ __( 'The default terminal for your sites.' ) }
				>
					<SettingsSelect
						label={ __( 'Default terminal app' ) }
						value={ data.terminal }
						options={ appElements(
							SUPPORTED_TERMINALS,
							installedApps,
							data.terminal,
							( terminal ) => terminalConfig[ terminal ].name()
						) }
						onChange={ ( terminal ) => onChange( { terminal } ) }
					/>
				</SettingsRow>
				<DefaultSiteDirectoryRow
					value={ data.defaultSiteDirectory }
					onSelect={ onDefaultSiteDirectorySelect }
					onSave={ ( defaultSiteDirectory ) => onChange( { defaultSiteDirectory } ) }
				/>
				<SettingsRow
					title={ __( 'Improve WordPress Studio for everyone' ) }
					description={ __( 'Share anonymous usage statistics to improve WordPress Studio.' ) }
				>
					<SettingsToggle
						label={ __( 'Improve WordPress Studio for everyone' ) }
						checked={ data.analyticsEnabled }
						onChange={ ( analyticsEnabled ) => onChange( { analyticsEnabled } ) }
					/>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title={ __( 'Interface' ) }>
				<NewSiteBehaviorRow />
				<SettingsRow
					title={ __( 'When WordPress Studio quits' ) }
					description={ __(
						'Choose what happens to running sites when you quit WordPress Studio.'
					) }
				>
					<SettingsSelect< QuitSitesBehavior | typeof UNSET >
						label={ __( 'When WordPress Studio quits' ) }
						value={ data.quitSitesBehavior }
						options={ getQuitSitesBehaviorElements() }
						onChange={ ( quitSitesBehavior ) => onChange( { quitSitesBehavior } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Start site when sending a prompt' ) }
					description={ __( 'Automatically start stopped sites when you send a chat message.' ) }
				>
					<SettingsToggle
						label={ __( 'Start site when sending a prompt' ) }
						checked={ data.autoStartSiteOnChat }
						onChange={ ( autoStartSiteOnChat ) => onChange( { autoStartSiteOnChat } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Open chat when starting a site' ) }
					description={ __( 'Show the chat panel alongside the preview when starting a site.' ) }
				>
					<SettingsToggle
						label={ __( 'Open chat when starting a site' ) }
						checked={ data.openChatOnSiteStart }
						onChange={ ( openChatOnSiteStart ) => onChange( { openChatOnSiteStart } ) }
					/>
				</SettingsRow>
				<SidebarSettings />
				<SettingsRow
					title={ __( 'Confirm before deleting annotations' ) }
					description={ __( 'Ask before deleting pending notes and attached images.' ) }
				>
					<SettingsToggle
						label={ __( 'Confirm before deleting annotations' ) }
						checked={ data.confirmDeleteAnnotations }
						onChange={ ( confirmDeleteAnnotations ) => onChange( { confirmDeleteAnnotations } ) }
					/>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Reset interface' ) }
					description={ __(
						'Restore default panel widths, theme, colors, and interface settings.'
					) }
				>
					<Button variant="outline" disabled={ interfaceIsDefault } onClick={ onResetInterface }>
						{ __( 'Reset interface' ) }
					</Button>
				</SettingsRow>
			</SettingsGroup>
			<StudioCliSection />
			<WapuuScore />
			<SettingsGroup title={ __( 'Help' ) }>
				<SettingsRow
					title={ __( 'Documentation' ) }
					description={ __( 'Guides for building and managing sites with WordPress Studio.' ) }
				>
					<Button
						variant="outline"
						onClick={ () =>
							void connector.openExternalUrl( getLocalizedLink( locale, 'docsStudio' ) )
						}
					>
						{ __( 'Open' ) }
						<ExternalLinkIcon data-icon="inline-end" />
					</Button>
				</SettingsRow>
				<SettingsRow
					title={ __( 'Report an issue on GitHub' ) }
					description={ __( 'Report a bug or request a feature.' ) }
				>
					<Button
						variant="outline"
						onClick={ () => void connector.openExternalUrl( REPORT_ISSUE_URL ) }
					>
						{ __( 'Report' ) }
						<ExternalLinkIcon data-icon="inline-end" />
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}

function usePreferencesForm() {
	const { data: saved, isError: loadFailed, refetch } = useUserPreferences();
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

	const resetInterface = useResetInterface();

	return {
		saved,
		data,
		handleChange,
		resetInterface: resetInterface.reset,
		saveError: savePreferences.isError || resetInterface.isError,
		loadFailed,
		retry: () => void refetch(),
	};
}

export function GeneralSettings() {
	const connector = useConnector();
	const { data: installedApps } = useInstalledApps();
	const { saved, data, handleChange, resetInterface, saveError, loadFailed, retry } =
		usePreferencesForm();
	if ( ! data || ! saved ) {
		return <SettingsLoadState loadFailed={ loadFailed } onRetry={ retry } />;
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
			interfaceIsDefault={ isDefaultInterface( saved ) }
			onResetInterface={ resetInterface }
			onDefaultSiteDirectorySelect={
				connector.capabilities.nativeFolderPicker ? () => void selectDefaultDirectory() : undefined
			}
			onChange={ handleChange }
		/>
	);
}

export function AppearanceSettings() {
	const { saved, data, handleChange, saveError, loadFailed, retry } = usePreferencesForm();
	const savePreferences = useSaveUserPreferences();
	const resetAppearance = useResetAppearance();
	if ( ! data || ! saved ) {
		return <SettingsLoadState loadFailed={ loadFailed } onRetry={ retry } />;
	}
	const tint = getColorTint( saved );
	return (
		<div className={ styles.preferencesPanel }>
			{ saveError || savePreferences.isError || resetAppearance.isError ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while saving settings. Please try again.' ) }
				</div>
			) : null }
			<SettingsGroup>
				<SettingsRow
					title={ __( 'Interface theme' ) }
					description={ __( 'Choose light, dark, or system.' ) }
				>
					<SettingsSelect
						label={ __( 'Interface theme' ) }
						value={ data.colorScheme }
						options={ getColorSchemeElements() }
						onChange={ ( colorScheme ) => handleChange( { colorScheme } ) }
					/>
				</SettingsRow>
				<ColorTintSettings tint={ tint } onCommit={ ( next ) => savePreferences.mutate( next ) } />
			</SettingsGroup>
			<SettingsGroup title={ __( 'Reset' ) }>
				<SettingsRow
					title={ __( 'Reset appearance' ) }
					description={ __(
						'Restore the default interface theme, accent color, intensity, and contrast.'
					) }
				>
					<Button
						variant="outline"
						disabled={ isDefaultColorTint( tint ) && data.colorScheme === 'system' }
						onClick={ resetAppearance.reset }
					>
						{ __( 'Reset' ) }
					</Button>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}

export function InstructionsSettings() {
	const { data: enabled } = useAgentInstructionsEnabled();
	const setEnabled = useSetAgentInstructionsEnabled();
	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow
					title={ __( 'Agent instructions' ) }
					description={ __(
						'Set coding standards, preferred tools, and response style for new chats across all sites.'
					) }
					error={ setEnabled.error?.message }
				>
					<SettingsToggle
						label={ __( 'Agent instructions' ) }
						checked={ enabled ?? true }
						disabled={ enabled === undefined }
						onChange={ ( value ) => setEnabled.mutate( value ) }
					/>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title={ __( 'Custom instructions' ) }>
				<InstructionsEditor />
			</SettingsGroup>
		</div>
	);
}

export { AiPanel } from './ai-panel';
export { KeyboardPanel } from './keyboard-panel';
export { McpPanel } from './mcp-panel';
export { SharingPanel } from './sharing-panel';
export { SkillsPanel } from './skills-panel';
export { UsagePanel } from './usage-panel';
