import { supportedLocaleNames } from '@studio/common/lib/locale';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { __, sprintf } from '@wordpress/i18n';
import { close, file, Icon } from '@wordpress/icons';
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
import { AccountSection } from './account-section';
import { AiPanel } from './ai-panel';
import { KeyboardPanel } from './keyboard-panel';
import { McpPanel } from './mcp-panel';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import { SkillsPanel } from './skills-panel';
import { StudioCliSection } from './studio-cli-section';
import styles from './style.module.css';
import { UsagePanel } from './usage-panel';
import { WapuuScore } from './wapuu-score';
import type { PreferencesFormData } from './preferences';
import type {
	ColorScheme,
	InstalledApps,
	QuitSitesBehavior,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
} from '@/data/core';
import type { ReactNode } from 'react';

const SETTINGS_TABS = [ 'preferences', 'ai', 'usage', 'keyboard', 'skills', 'mcp' ] as const;

type TabId = ( typeof SETTINGS_TABS )[ number ];

export function isSettingsTab( value: string ): value is TabId {
	return SETTINGS_TABS.some( ( tab ) => tab === value );
}

export type SettingsTabId = TabId;

// No "unset" option: the main process resolves a fallback for never-chosen
// editor/terminal prefs (matching the legacy UI), so an explicit clear can't
// round-trip. The select shows its placeholder when nothing is installed.
function editorElements( installedApps: InstalledApps | undefined ) {
	return SUPPORTED_EDITORS.filter( ( editor ) => ! installedApps || installedApps[ editor ] ).map(
		( editor ) => ( {
			value: editor,
			label: supportedEditorConfig[ editor ].label,
		} )
	);
}

function terminalElements( installedApps: InstalledApps | undefined ) {
	return SUPPORTED_TERMINALS.filter(
		( terminal ) => ! installedApps || installedApps[ terminal ]
	).map( ( terminal ) => ( {
		value: terminal,
		label: terminalConfig[ terminal ].name,
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

function SettingsHeader() {
	// Settings renders fullscreen, so the sidebar (and its floating toggle) is
	// covered — only the macOS traffic lights still need clearing.
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const onClose = useSettingsClose();
	return (
		<div className={ styles.header }>
			{ reserveTrafficLightSpace ? (
				<div className={ styles.headerStart }>
					<span className={ styles.toggleSpacer } aria-hidden="true" />
				</div>
			) : null }
			<div className={ styles.headerTabs }>
				<Tabs.List className={ styles.headerTabList }>
					<Tabs.Tab tabId="preferences">{ __( 'Settings' ) }</Tabs.Tab>
					<Tabs.Tab tabId="ai">{ __( 'AI' ) }</Tabs.Tab>
					<Tabs.Tab tabId="usage">{ __( 'Usage' ) }</Tabs.Tab>
					<Tabs.Tab tabId="keyboard">{ __( 'Keyboard' ) }</Tabs.Tab>
					<Tabs.Tab tabId="skills">{ __( 'Skills' ) }</Tabs.Tab>
					<Tabs.Tab tabId="mcp">{ __( 'MCP' ) }</Tabs.Tab>
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
		<section className={ styles.preferenceRow }>
			<div className={ styles.preferenceText }>
				<h2>{ title }</h2>
				{ description ? <p>{ description }</p> : null }
			</div>
			<div className={ styles.preferenceControl }>{ children }</div>
		</section>
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
				<Icon icon={ file } className={ styles.pathPickerIcon } />
			</button>
		</PreferenceRow>
	);
}

function StudioExperienceSection() {
	const connector = useConnector();
	if ( ! connector.capabilities.switchToClassicUi ) {
		return null;
	}
	return (
		<section className={ styles.preferenceSectionGroup }>
			<PreferenceRow
				title={ __( 'Studio experience' ) }
				description={ __( 'You are using the new Studio experience.' ) }
			>
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					onClick={ () => void connector.disableAgenticUi() }
				>
					{ __( 'Switch to classic' ) }
				</Button>
			</PreferenceRow>
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
		<div className={ styles.preferencesPanel }>
			<section className={ styles.preferenceSectionGroup }>
				<h2 className={ styles.preferenceSectionHeading }>{ __( 'General' ) }</h2>
				{ saveError ? (
					<div className={ styles.errorMessage }>
						{ __( 'An error occurred while saving settings. Please try again.' ) }
					</div>
				) : null }
				<AppearancePicker value={ data.colorScheme } onChange={ onColorSchemeChange } />
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
					<PreferenceSelect< QuitSitesBehavior | typeof UNSET >
						label={ __( 'When quitting with running sites' ) }
						className={ styles.selectControlWide }
						value={ data.quitSitesBehavior }
						options={ QUIT_SITES_BEHAVIOR_ELEMENTS }
						onChange={ ( quitSitesBehavior ) => onChange( { quitSitesBehavior } ) }
					/>
				</PreferenceRow>
			</section>
			<AccountSection />
			<WapuuScore />
			<StudioCliSection />
			<StudioExperienceSection />
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
			savePreferences.mutate( patch, {
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
						<Tabs.Panel tabId="usage">
							<UsagePanel />
						</Tabs.Panel>
						<Tabs.Panel tabId="keyboard">
							<KeyboardPanel />
						</Tabs.Panel>
						<Tabs.Panel tabId="skills">
							<SkillsPanel />
						</Tabs.Panel>
						<Tabs.Panel tabId="mcp">
							<McpPanel />
						</Tabs.Panel>
					</div>
				</div>
			</Tabs.Root>
		</div>
	);
}
