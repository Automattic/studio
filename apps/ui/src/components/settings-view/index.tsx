import {
	ACTIVITY_SOUND_EVENTS,
	type ActivitySoundEvent,
	type ActivitySoundId,
	type ActivitySoundPreferences,
} from '@studio/common/lib/activity-sounds';
import { supportedLocaleNames } from '@studio/common/lib/locale';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { FormToggle } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { audio, close } from '@wordpress/icons';
import { Button, IconButton, SelectControl } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSettingsClose } from '@/hooks/use-settings-close';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { playActivitySound } from '@/lib/activity-sounds';
import { AccountSection } from './account-section';
import { AiPanel } from './ai-panel';
import { KeyboardPanel } from './keyboard-panel';
import { McpSection } from './mcp-panel';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import { StudioCliSection } from './studio-cli-section';
import styles from './style.module.css';
import type { PreferencesFormData } from './preferences';
import type {
	ColorScheme,
	InstalledApps,
	QuitSitesBehaviorSetting,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
} from '@/data/core';
import type { CSSProperties, ReactNode } from 'react';

const SETTINGS_TABS = [ 'preferences', 'ai' ] as const;

type TabId = ( typeof SETTINGS_TABS )[ number ];

export function isSettingsTab( value: string ): value is TabId {
	return SETTINGS_TABS.some( ( tab ) => tab === value );
}

// Deep links and settings events can carry tab ids that no longer exist after
// the two-tab redesign (e.g. `usage`, `keyboard`, `mcp`); fall back to the
// Settings tab so the route always resolves.
export function normalizeSettingsTab( value: string | undefined ): TabId {
	if ( value && isSettingsTab( value ) ) {
		return value;
	}
	return 'preferences';
}

export type SettingsTabId = TabId;

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

const COLOR_SCHEME_ELEMENTS: { value: ColorScheme; label: string }[] = [
	{ value: 'system', label: __( 'System' ) },
	{ value: 'light', label: __( 'Light' ) },
	{ value: 'dark', label: __( 'Dark' ) },
];

function isColorScheme( value: unknown ): value is ColorScheme {
	return value === 'system' || value === 'light' || value === 'dark';
}

// The swatch shown for the scheme-aware default (its value is `null`, which
// clears the override). Matches CHROME_BG_LIGHT in sidebar-layout.
const FRAME_COLOR_DEFAULT_SWATCH = '#1e1e1e';

// Preset window-chrome ("frame") colors — dark, rich tones so the chrome keeps
// its inset look. Custom lets the user pick any single color of their own.
const FRAME_COLOR_PRESETS: { value: string; label: string }[] = [
	{ value: '#1c2431', label: __( 'Ink' ) },
	{ value: '#123138', label: __( 'Ocean' ) },
	{ value: '#1b3125', label: __( 'Forest' ) },
	{ value: '#2b1f38', label: __( 'Plum' ) },
	{ value: '#331d26', label: __( 'Wine' ) },
	{ value: '#2b2118', label: __( 'Espresso' ) },
];

const QUIT_SITES_BEHAVIOR_ELEMENTS: {
	value: QuitSitesBehaviorSetting;
	label: string;
}[] = [
	{ value: 'ask', label: __( 'Ask every time' ) },
	{ value: 'leave-running', label: __( 'Keep sites running' ) },
	{ value: 'stop-and-auto-start', label: __( 'Stop, restart on next launch' ) },
	{ value: 'stop', label: __( 'Stop sites' ) },
];

type AnalyticsChoice = 'share' | 'off';

const ANALYTICS_ELEMENTS: { value: AnalyticsChoice; label: string }[] = [
	{ value: 'share', label: __( 'Share anonymous data' ) },
	{ value: 'off', label: __( 'Don’t share' ) },
];

const LOCALE_ELEMENTS: { value: SupportedLocale; label: string }[] = Object.entries(
	supportedLocaleNames
).map( ( [ value, label ] ) => ( { value: value as SupportedLocale, label } ) );

function SettingsHeader() {
	const trafficLightSpace = useTrafficLightSpace();
	const onClose = useSettingsClose();
	return (
		<div className={ styles.header }>
			{ trafficLightSpace.start ? (
				<div className={ styles.headerStart }>
					<span className={ styles.toggleSpacer } aria-hidden="true" />
				</div>
			) : null }
			<div className={ styles.headerTabs }>
				<Tabs.List className={ styles.headerTabList }>
					<Tabs.Tab tabId="preferences">{ __( 'Settings' ) }</Tabs.Tab>
					<Tabs.Tab tabId="ai">{ __( 'Agent' ) }</Tabs.Tab>
				</Tabs.List>
			</div>
			{ onClose ? (
				<div className={ styles.headerEnd }>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ close }
						label={ __( 'Close settings' ) }
						onClick={ onClose }
					/>
					{ trafficLightSpace.end ? (
						<span className={ styles.toggleSpacer } aria-hidden="true" />
					) : null }
				</div>
			) : null }
		</div>
	);
}

function PreferenceRow( {
	title,
	description,
	children,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
} ) {
	return (
		<div className={ styles.field }>
			<div className={ styles.fieldText }>
				<span className={ styles.fieldLabel }>{ title }</span>
				{ description ? <span className={ styles.fieldDescription }>{ description }</span> : null }
			</div>
			<div className={ styles.fieldControl }>{ children }</div>
		</div>
	);
}

function AppearancePicker( {
	value,
	onChange,
}: {
	value: ColorScheme;
	onChange: ( value: ColorScheme ) => void;
} ) {
	const activeIndex = Math.max(
		0,
		COLOR_SCHEME_ELEMENTS.findIndex( ( option ) => option.value === value )
	);

	return (
		<PreferenceRow title={ __( 'Appearance' ) }>
			<div
				className={ styles.appearancePicker }
				role="group"
				aria-label={ __( 'Appearance' ) }
				data-active-index={ activeIndex }
			>
				{ COLOR_SCHEME_ELEMENTS.map( ( option ) => (
					<button
						key={ option.value }
						type="button"
						className={ clsx(
							styles.appearanceButton,
							option.value === value && styles.appearanceButtonActive
						) }
						aria-pressed={ option.value === value }
						onClick={ () => onChange( option.value ) }
					>
						{ option.label }
					</button>
				) ) }
			</div>
		</PreferenceRow>
	);
}

function FrameColorPicker( {
	value,
	onChange,
}: {
	value: string | null;
	onChange: ( value: string | null ) => void;
} ) {
	const normalized = value?.toLowerCase() ?? null;
	const isDefault = normalized === null;
	const isPreset = FRAME_COLOR_PRESETS.some( ( preset ) => preset.value === normalized );
	const isCustom = ! isDefault && ! isPreset;
	// The native picker opens on the active custom color, or on the default
	// swatch as a starting point when a preset/default is currently selected.
	const customColor = isCustom ? ( normalized as string ) : FRAME_COLOR_DEFAULT_SWATCH;

	return (
		<PreferenceRow title={ __( 'Frame color' ) }>
			<div className={ styles.framePicker } role="group" aria-label={ __( 'Frame color' ) }>
				<button
					type="button"
					className={ clsx( styles.frameSwatch, isDefault && styles.frameSwatchActive ) }
					style={ { '--frame-swatch-color': FRAME_COLOR_DEFAULT_SWATCH } as CSSProperties }
					aria-pressed={ isDefault }
					aria-label={ __( 'Default' ) }
					title={ __( 'Default' ) }
					onClick={ () => onChange( null ) }
				/>
				{ FRAME_COLOR_PRESETS.map( ( preset ) => (
					<button
						key={ preset.value }
						type="button"
						className={ clsx(
							styles.frameSwatch,
							normalized === preset.value && styles.frameSwatchActive
						) }
						style={ { '--frame-swatch-color': preset.value } as CSSProperties }
						aria-pressed={ normalized === preset.value }
						aria-label={ preset.label }
						title={ preset.label }
						onClick={ () => onChange( preset.value ) }
					/>
				) ) }
				<label
					className={ clsx(
						styles.frameSwatch,
						styles.frameSwatchCustom,
						isCustom && styles.frameSwatchActive
					) }
					style={
						isCustom ? ( { '--frame-swatch-color': customColor } as CSSProperties ) : undefined
					}
					title={ __( 'Custom color' ) }
				>
					<input
						type="color"
						className={ styles.frameSwatchInput }
						value={ customColor }
						aria-label={ __( 'Custom color' ) }
						onChange={ ( event ) => onChange( event.target.value ) }
					/>
				</label>
			</div>
		</PreferenceRow>
	);
}

function PreferenceSelect< TValue extends string >( {
	label,
	value,
	options,
	onChange,
	className,
}: {
	label: string;
	value: TValue;
	options: Array< { value: TValue; label: string } >;
	onChange: ( value: TValue ) => void;
	className?: string;
} ) {
	const selectedItem = options.find( ( option ) => option.value === value );

	return (
		<SelectControl
			hideLabelFromVision
			className={ clsx( styles.selectControl, className ) }
			items={ options }
			label={ label }
			value={ selectedItem ?? null }
			onValueChange={ ( item ) => {
				if ( item?.value !== undefined && item.value !== null ) {
					onChange( item.value as TValue );
				}
			} }
		/>
	);
}

function DefaultSiteDirectoryField( { value, onSelect }: { value: string; onSelect: () => void } ) {
	return (
		<PreferenceRow title={ __( 'Default site directory' ) }>
			<button
				type="button"
				className={ styles.pathPickerButton }
				aria-label={
					value
						? sprintf( __( 'Default site directory: %s. Choose a different folder.' ), value )
						: __( 'Choose a default site directory' )
				}
				onClick={ onSelect }
			>
				<span className={ value ? styles.pathPickerValue : styles.pathPickerPlaceholder }>
					{ value || __( 'Choose a folder…' ) }
				</span>
			</button>
		</PreferenceRow>
	);
}

// Leaving the agentic UI entirely is a separate, heavier action than the AI
// tab's chat toggle: it reloads the window into the classic Studio interface.
// Only hosts that ship the classic renderer can switch (see capabilities).
function StudioExperienceSection() {
	const connector = useConnector();
	if ( ! connector.capabilities.switchToClassicUi ) {
		return null;
	}
	return (
		<section className={ styles.card }>
			<div className={ clsx( styles.cardHeader, styles.cardHeaderCentered ) }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'Studio Beta' ) }</h2>
					<p className={ styles.cardDescription }>
						{ __( 'You’re using the new Studio with AI chat and a built-in site preview.' ) }
					</p>
				</div>
				<div className={ styles.cardHeaderActions }>
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						size="compact"
						onClick={ () => void connector.disableAgenticUi() }
					>
						{ __( 'Switch to classic' ) }
					</Button>
				</div>
			</div>
		</section>
	);
}

function activitySoundOptions(): Array< { value: ActivitySoundId | 'none'; label: string } > {
	return [
		{ value: 'none', label: __( 'None' ) },
		{ value: 'soft-chime', label: __( 'Soft chime' ) },
		{ value: 'bright-chime', label: __( 'Bright chime' ) },
		{ value: 'pop', label: __( 'Pop' ) },
		{ value: 'pulse', label: __( 'Pulse' ) },
	];
}

function activitySoundEventLabel( event: ActivitySoundEvent ): string {
	switch ( event ) {
		case 'attention-required':
			return __( 'Needs your input' );
		case 'agent-complete':
			return __( 'Agent finished' );
		case 'sync-started':
			return __( 'Sync started' );
		case 'sync-complete':
			return __( 'Sync finished' );
		case 'sync-failed':
			return __( 'Sync failed' );
	}
}

function ActivitySoundsSection( {
	value,
	onChange,
}: {
	value: ActivitySoundPreferences;
	onChange: ( value: ActivitySoundPreferences ) => void;
} ) {
	const options = activitySoundOptions();

	return (
		<section className={ clsx( styles.card, ! value.enabled && styles.cardDisabled ) }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ __( 'Activity sounds' ) }</h2>
					<p className={ styles.cardDescription }>
						{ __( 'Choose the sounds Studio plays for agent and live-site activity.' ) }
					</p>
				</div>
				<div className={ clsx( styles.cardHeaderActions, styles.toggleControl ) }>
					<FormToggle
						aria-label={ __( 'Activity sounds' ) }
						checked={ value.enabled }
						onChange={ ( event ) => onChange( { ...value, enabled: event.target.checked } ) }
					/>
				</div>
			</div>
			{ value.enabled ? (
				<div className={ styles.fieldList }>
					{ ACTIVITY_SOUND_EVENTS.map( ( event ) => {
						const selectedSound = value.events[ event ];
						const label = activitySoundEventLabel( event );
						return (
							<PreferenceRow key={ event } title={ label }>
								<div className={ styles.soundControl }>
									<PreferenceSelect< ActivitySoundId | 'none' >
										label={ label }
										value={ selectedSound ?? 'none' }
										options={ options }
										onChange={ ( soundId ) =>
											onChange( {
												...value,
												events: {
													...value.events,
													[ event ]: soundId === 'none' ? null : soundId,
												},
											} )
										}
									/>
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ audio }
										label={ sprintf(
											/* translators: %s: the activity that plays the sound, e.g. "Agent finished". */
											__( 'Preview sound for %s' ),
											label
										) }
										disabled={ ! selectedSound }
										onClick={ () => {
											if ( selectedSound ) {
												void playActivitySound( selectedSound );
											}
										} }
									/>
								</div>
							</PreferenceRow>
						);
					} ) }
				</div>
			) : null }
		</section>
	);
}

function PreferencesPanel( {
	data,
	installedApps,
	saveError,
	onColorSchemeChange,
	onDefaultSiteDirectorySelect,
	onChange,
}: {
	data: PreferencesFormData;
	installedApps: InstalledApps | undefined;
	saveError: boolean;
	onColorSchemeChange: ( value: ColorScheme ) => void;
	onDefaultSiteDirectorySelect: () => void;
	onChange: ( update: Partial< PreferencesFormData > ) => void;
} ) {
	return (
		<div className={ styles.settingsLayout }>
			<AccountSection />
			<div className={ styles.settingsMain }>
				<section className={ styles.card }>
					<div className={ styles.cardHeader }>
						<div className={ styles.cardHeaderText }>
							<h2 className={ styles.cardTitle }>{ __( 'General' ) }</h2>
						</div>
					</div>
					{ saveError ? (
						<div className={ styles.errorMessage }>
							{ __( 'An error occurred while saving settings. Please try again.' ) }
						</div>
					) : null }
					<div className={ styles.fieldList }>
						<AppearancePicker value={ data.colorScheme } onChange={ onColorSchemeChange } />
						<FrameColorPicker
							value={ data.frameColor }
							onChange={ ( frameColor ) => onChange( { frameColor } ) }
						/>
						<PreferenceRow title={ __( 'Language' ) }>
							<PreferenceSelect
								label={ __( 'Language' ) }
								value={ data.locale }
								options={ LOCALE_ELEMENTS }
								onChange={ ( locale ) => onChange( { locale } ) }
							/>
						</PreferenceRow>
						<PreferenceRow title={ __( 'Preferred editor' ) }>
							<PreferenceSelect< SupportedEditor | typeof UNSET >
								label={ __( 'Preferred editor' ) }
								value={ data.editor }
								options={ editorElements( installedApps ) }
								onChange={ ( editor ) => onChange( { editor } ) }
							/>
						</PreferenceRow>
						<PreferenceRow title={ __( 'Preferred terminal' ) }>
							<PreferenceSelect< SupportedTerminal | typeof UNSET >
								label={ __( 'Preferred terminal' ) }
								value={ data.terminal }
								options={ terminalElements( installedApps ) }
								onChange={ ( terminal ) => onChange( { terminal } ) }
							/>
						</PreferenceRow>
						<DefaultSiteDirectoryField
							value={ data.defaultSiteDirectory }
							onSelect={ onDefaultSiteDirectorySelect }
						/>
						<PreferenceRow title={ __( 'When quitting with running sites' ) }>
							<PreferenceSelect< QuitSitesBehaviorSetting >
								label={ __( 'When quitting with running sites' ) }
								className={ styles.selectControlWide }
								value={ data.quitSitesBehavior }
								options={ QUIT_SITES_BEHAVIOR_ELEMENTS }
								onChange={ ( quitSitesBehavior ) => onChange( { quitSitesBehavior } ) }
							/>
						</PreferenceRow>
						<PreferenceRow title={ __( 'Help improve Studio by sharing anonymous usage data' ) }>
							<PreferenceSelect< AnalyticsChoice >
								label={ __( 'Help improve Studio by sharing anonymous usage data' ) }
								className={ styles.selectControlAuto }
								value={ data.analyticsEnabled ? 'share' : 'off' }
								options={ ANALYTICS_ELEMENTS }
								onChange={ ( choice ) => onChange( { analyticsEnabled: choice === 'share' } ) }
							/>
						</PreferenceRow>
					</div>
				</section>
				<ActivitySoundsSection
					value={ data.activitySoundPreferences }
					onChange={ ( activitySoundPreferences ) => onChange( { activitySoundPreferences } ) }
				/>
				<KeyboardPanel />
				<StudioCliSection />
				<McpSection />
				<StudioExperienceSection />
			</div>
		</div>
	);
}

export function SettingsView( {
	activeTab,
	onTabChange,
}: {
	activeTab: TabId;
	onTabChange: ( tab: TabId ) => void;
} ) {
	const connector = useConnector();
	const { data: saved, isLoading } = useUserPreferences();
	const { data: installedApps } = useInstalledApps();
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
			} );
		},
		[ savePreferences ]
	);

	const handleColorSchemeChange = useCallback(
		( colorScheme: ColorScheme ) => {
			if ( ! isColorScheme( colorScheme ) ) {
				return;
			}
			handleChange( { colorScheme } );
		},
		[ handleChange ]
	);

	if ( isLoading || ! data || ! saved ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const handleSelectDefaultDirectory = async () => {
		const directory = await connector.selectDefaultSiteDirectory( data.defaultSiteDirectory );
		if ( directory ) {
			handleChange( { defaultSiteDirectory: directory } );
		}
	};

	return (
		<div className={ styles.root }>
			<Tabs.Root
				selectedTabId={ activeTab }
				onSelect={ ( tabId ) => {
					if ( tabId && isSettingsTab( tabId ) ) {
						onTabChange( tabId );
					}
				} }
			>
				<SettingsHeader />

				<div className={ styles.scroll }>
					<div className={ styles.contentBlock }>
						<Tabs.Panel tabId="preferences">
							<PreferencesPanel
								data={ data }
								installedApps={ installedApps }
								saveError={ savePreferences.isError }
								onColorSchemeChange={ handleColorSchemeChange }
								onDefaultSiteDirectorySelect={ () => void handleSelectDefaultDirectory() }
								onChange={ handleChange }
							/>
						</Tabs.Panel>
						<Tabs.Panel tabId="ai">
							<AiPanel />
						</Tabs.Panel>
					</div>
				</div>
			</Tabs.Root>
		</div>
	);
}
