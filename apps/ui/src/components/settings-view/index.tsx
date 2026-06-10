import { isSupportedLocale, supportedLocaleNames } from '@studio/common/lib/locale';
import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { DEFAULT_MESSAGE_SEND_SHORTCUT } from '@studio/common/lib/user-settings/message-send-shortcut';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import {
	FormToggle,
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { external, file, moreHorizontal } from '@wordpress/icons';
import { Button, Icon, IconButton, SelectControl } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gravatar } from '@/components/gravatar';
import { LearnMoreLink } from '@/components/learn-more';
import * as Menu from '@/components/menu';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import {
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { KEYBOARD_SHORTCUTS, getKeyboardShortcutLabel } from '@/lib/keyboard-shortcuts';
import { isMacPlatform } from '@/lib/platform';
import styles from './style.module.css';
import type {
	ColorScheme,
	InstalledApps,
	MessageSendShortcut,
	SkillStatus,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';
import type { FormEvent, ReactNode } from 'react';

type TabId = 'preferences' | 'account' | 'skills' | 'mcp';

export function isSettingsTab( value: string ): value is TabId {
	return value === 'preferences' || value === 'account' || value === 'skills' || value === 'mcp';
}

export type SettingsTabId = TabId;

// Empty-string sentinel for "not set" — select-style fields need a primitive
// value, so we can't use null directly.
const UNSET = '' as const;
const DEFAULT_PREVIEW_SITE_LIMIT = 10;
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

interface FormData {
	editor: SupportedEditor | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
	defaultSiteDirectory: string;
	locale: SupportedLocale;
	messageSendShortcut: MessageSendShortcut;
	studioCliInstalled: boolean;
}

// The saved locale can be any string the main process resolved (including ones
// outside our catalog). Clamp to a SupportedLocale so the form control always
// has a valid option selected.
function resolveFormLocale( locale: string | undefined ): SupportedLocale {
	return isSupportedLocale( locale ) ? locale : 'en';
}

function toFormData( prefs: UserPreferences ): FormData {
	return {
		editor: prefs.editor ?? UNSET,
		terminal: prefs.terminal ?? UNSET,
		colorScheme: prefs.colorScheme,
		defaultSiteDirectory: prefs.defaultSiteDirectory ?? '',
		locale: resolveFormLocale( prefs.locale ),
		messageSendShortcut: prefs.messageSendShortcut ?? DEFAULT_MESSAGE_SEND_SHORTCUT,
		studioCliInstalled: prefs.studioCliInstalled ?? false,
	};
}

function diffFromSaved(
	next: FormData,
	saved: UserPreferences
): Partial< WritableUserPreferences > {
	const patch: Partial< WritableUserPreferences > = {};
	const nextEditor: SupportedEditor | null = next.editor === UNSET ? null : next.editor;
	const nextTerminal: SupportedTerminal | null = next.terminal === UNSET ? null : next.terminal;
	const savedDefaultSiteDirectory = saved.defaultSiteDirectory ?? '';
	const savedMessageSendShortcut = saved.messageSendShortcut ?? DEFAULT_MESSAGE_SEND_SHORTCUT;
	const savedStudioCliInstalled = saved.studioCliInstalled ?? false;
	if ( nextEditor !== saved.editor ) patch.editor = nextEditor;
	if ( nextTerminal !== saved.terminal ) patch.terminal = nextTerminal;
	if ( next.colorScheme !== saved.colorScheme ) patch.colorScheme = next.colorScheme;
	if ( next.defaultSiteDirectory !== savedDefaultSiteDirectory ) {
		patch.defaultSiteDirectory = next.defaultSiteDirectory;
	}
	if ( next.locale !== resolveFormLocale( saved.locale ) ) patch.locale = next.locale;
	if ( next.messageSendShortcut !== savedMessageSendShortcut ) {
		patch.messageSendShortcut = next.messageSendShortcut;
	}
	if ( next.studioCliInstalled !== savedStudioCliInstalled ) {
		patch.studioCliInstalled = next.studioCliInstalled;
	}
	return patch;
}

function editorElements( installedApps: InstalledApps | undefined ) {
	const options = SUPPORTED_EDITORS.filter(
		( editor ) => ! installedApps || installedApps[ editor ]
	).map( ( editor ) => ( {
		value: editor,
		label: supportedEditorConfig[ editor ].label,
	} ) );
	return [ { value: UNSET, label: __( 'Not set' ) }, ...options ];
}

function terminalElements( installedApps: InstalledApps | undefined ) {
	const options = SUPPORTED_TERMINALS.filter(
		( terminal ) => ! installedApps || installedApps[ terminal ]
	).map( ( terminal ) => ( {
		value: terminal,
		label: terminalConfig[ terminal ].name,
	} ) );
	return [ { value: UNSET, label: __( 'Not set' ) }, ...options ];
}

const LOCALE_ELEMENTS: { value: SupportedLocale; label: string }[] = Object.entries(
	supportedLocaleNames
).map( ( [ value, label ] ) => ( { value: value as SupportedLocale, label } ) );

function messageSendShortcutElements(): { value: MessageSendShortcut; label: string }[] {
	return [
		{ value: 'enter', label: __( 'Enter sends' ) },
		{
			value: 'mod-enter',
			label: isMacPlatform() ? __( '⌘ Enter sends' ) : __( 'Control Enter sends' ),
		},
	];
}

const APPEARANCE_OPTIONS: Array< {
	value: ColorScheme;
	// Lazy so the label translates at render time; module scope evaluates
	// before `setLocaleData()` runs in main.tsx and would freeze English in.
	getLabel: () => string;
} > = [
	{ value: 'system', getLabel: () => __( 'System' ) },
	{ value: 'light', getLabel: () => __( 'Light' ) },
	{ value: 'dark', getLabel: () => __( 'Dark' ) },
];

function isColorScheme( value: string | number | undefined ): value is ColorScheme {
	return (
		typeof value === 'string' && APPEARANCE_OPTIONS.some( ( option ) => option.value === value )
	);
}

function SettingsHeader( {
	showSaveButton,
	canSubmit,
	isSaving,
	onSave,
}: {
	showSaveButton: boolean;
	canSubmit: boolean;
	isSaving: boolean;
	onSave: () => void;
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const reserveTrafficLightSpace = sidebarCollapsed && isMacPlatform() && ! isFullscreen;

	return (
		<div className={ clsx( styles.header, ! sidebarCollapsed && styles.headerSidebarOpen ) }>
			<div className={ styles.headerStart }>
				{ reserveTrafficLightSpace ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
			</div>
			<div className={ styles.headerTabs }>
				<Tabs.List className={ styles.headerTabList }>
					<Tabs.Tab tabId="preferences">{ __( 'Preferences' ) }</Tabs.Tab>
					<Tabs.Tab tabId="account">{ __( 'Account' ) }</Tabs.Tab>
					<Tabs.Tab tabId="skills">{ __( 'Skills' ) }</Tabs.Tab>
					<Tabs.Tab tabId="mcp">{ __( 'MCP' ) }</Tabs.Tab>
				</Tabs.List>
			</div>
			<div className={ styles.headerActions }>
				{ showSaveButton ? (
					<Button
						type="button"
						variant="solid"
						tone="brand"
						size="compact"
						disabled={ ! canSubmit }
						loading={ isSaving }
						loadingAnnouncement={ __( 'Saving preferences' ) }
						onClick={ onSave }
					>
						{ __( 'Save' ) }
					</Button>
				) : null }
			</div>
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
	return (
		<PreferenceRow title={ __( 'Appearance' ) }>
			<ToggleGroupControl
				__next40pxDefaultSize
				__nextHasNoMarginBottom
				className={ styles.segmentedControl }
				hideLabelFromVision
				isAdaptiveWidth
				label={ __( 'Appearance' ) }
				value={ value }
				onChange={ ( nextValue ) => {
					if ( isColorScheme( nextValue ) ) {
						onChange( nextValue );
					}
				} }
			>
				{ APPEARANCE_OPTIONS.map( ( option ) => (
					<ToggleGroupControlOption
						key={ option.value }
						value={ option.value }
						label={ option.getLabel() }
					/>
				) ) }
			</ToggleGroupControl>
		</PreferenceRow>
	);
}

function PreferenceSelect< TValue extends string >( {
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: TValue;
	options: Array< { value: TValue; label: string } >;
	onChange: ( value: TValue ) => void;
} ) {
	const selectedItem = options.find( ( option ) => option.value === value );

	return (
		<SelectControl
			hideLabelFromVision
			className={ styles.selectControl }
			items={ options }
			label={ label }
			value={ selectedItem }
			onValueChange={ ( item ) => {
				if ( item?.value !== undefined && item.value !== null ) {
					onChange( item.value as TValue );
				}
			} }
		/>
	);
}

function DefaultSiteDirectoryField( { value, onSelect }: { value: string; onSelect: () => void } ) {
	const buttonLabel = value
		? sprintf( __( 'Default site directory: %s. Choose a different folder.' ), value )
		: __( 'Choose a default site directory' );

	return (
		<PreferenceRow title={ __( 'Default site directory' ) }>
			<button
				type="button"
				className={ styles.pathField }
				aria-label={ buttonLabel }
				onClick={ onSelect }
			>
				<span className={ value ? styles.pathValue : styles.pathPlaceholder }>
					{ value || __( 'Choose a folder…' ) }
				</span>
				<span className={ styles.pathFieldAction } aria-hidden="true">
					<Icon icon={ file } size={ 18 } />
				</span>
			</button>
		</PreferenceRow>
	);
}

function StudioCliSection( {
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: ( value: boolean ) => void;
} ) {
	return (
		<section className={ styles.preferenceSectionGroup }>
			<h2 className={ styles.preferenceSectionHeading }>{ __( 'Studio CLI' ) }</h2>
			<div className={ styles.cliRow }>
				<p>
					{ __( 'Use the studio command in any terminal to manage sites and run WP-CLI.' ) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsCli" />
				</p>
				<FormToggle
					id="studio-cli-toggle"
					aria-label={ __( 'Studio CLI for terminal' ) }
					className={ styles.cliToggle }
					checked={ checked }
					onChange={ ( event ) => onChange( event.target.checked ) }
				/>
			</div>
		</section>
	);
}

function GeneralPreferencesSection( {
	data,
	installedApps,
	messageSendShortcut,
	onColorSchemeChange,
	onDefaultSiteDirectorySelect,
	onChange,
}: {
	data: FormData;
	installedApps: InstalledApps | undefined;
	messageSendShortcut: MessageSendShortcut;
	onColorSchemeChange: ( value: ColorScheme ) => void;
	onDefaultSiteDirectorySelect: () => void;
	onChange: ( update: Record< string, unknown > ) => void;
} ) {
	return (
		<section className={ clsx( styles.preferenceSectionGroup, styles.generalPreferences ) }>
			<h2 className={ styles.preferenceSectionHeading }>{ __( 'General settings' ) }</h2>
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
			<PreferenceRow
				title={ __( 'Chat message sending' ) }
				description={ __( 'Sets the send\u00a0shortcut.' ) }
			>
				<PreferenceSelect
					label={ __( 'Chat message sending' ) }
					value={ messageSendShortcut }
					options={ messageSendShortcutElements() }
					onChange={ ( nextMessageSendShortcut ) =>
						onChange( { messageSendShortcut: nextMessageSendShortcut } )
					}
				/>
			</PreferenceRow>
		</section>
	);
}

function KeyboardShortcutsList() {
	return (
		<section className={ styles.keyboardSection }>
			<ul className={ styles.shortcutList }>
				{ KEYBOARD_SHORTCUTS.map( ( shortcut ) => (
					<li key={ shortcut.id } className={ styles.shortcutRow }>
						<span className={ styles.shortcutLabel }>{ shortcut.getLabel() }</span>
						<kbd className={ styles.shortcutKey }>{ getKeyboardShortcutLabel( shortcut ) }</kbd>
					</li>
				) ) }
			</ul>
		</section>
	);
}

function KeyboardShortcutsSection() {
	return (
		<section className={ clsx( styles.preferenceSectionGroup, styles.keyboardPreferences ) }>
			<h2 className={ styles.preferenceSectionHeading }>{ __( 'Shortcuts' ) }</h2>
			<KeyboardShortcutsList />
		</section>
	);
}

function PreviewSitesSummary() {
	const { data: snapshots, isLoading } = useSnapshots();
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useSnapshotUsage();
	const deleteAllSnapshots = useDeleteAllSnapshots();
	const siteCount = snapshotUsage?.siteCount ?? snapshots?.length ?? 0;
	const siteLimit = snapshotUsage?.siteLimit ?? DEFAULT_PREVIEW_SITE_LIMIT;
	const progressMax = Math.max( siteLimit, 1 );
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const isLoadingPreviewUsage = isLoading || isLoadingSnapshotUsage || deleteAllSnapshots.isPending;
	const isDisabled = siteCount === 0 || snapshotCreationBlocked || isLoadingPreviewUsage;
	const progress = Math.min( siteCount / progressMax, 1 ) * 100;

	const handleDelete = () => {
		if ( isDisabled ) {
			return;
		}
		const confirmed = window.confirm(
			__(
				'All preview sites that exist for your WordPress.com account, along with their posts, pages, comments, and media, will be lost.'
			)
		);
		if ( confirmed ) {
			deleteAllSnapshots.mutate();
		}
	};

	return (
		<section className={ styles.accountOverviewSection }>
			<div className={ styles.accountOverviewHeader }>
				<h2>{ __( 'Preview sites' ) }</h2>
			</div>
			{ snapshotCreationBlocked ? (
				<div className={ styles.previewUsageText }>
					{ __( 'Preview sites are not available for your account.' ) }
				</div>
			) : (
				<div className={ styles.accountUsageContent }>
					<div className={ styles.previewUsage }>
						<div className={ styles.previewUsageText }>
							{ isLoadingPreviewUsage
								? __( 'Loading…' )
								: sprintf(
										/* translators: 1: number of active preview sites, 2: maximum allowed */
										_n(
											'%1$d of %2$d active preview site',
											'%1$d of %2$d active preview sites',
											siteLimit
										),
										siteCount,
										siteLimit
								  ) }
						</div>
					</div>
					<div className={ styles.previewUsageControls }>
						<div className={ styles.progressTrack } aria-hidden="true">
							<div className={ styles.progressValue } style={ { inlineSize: `${ progress }%` } } />
						</div>
						<Menu.Root modal={ false }>
							<Menu.Trigger
								render={
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ moreHorizontal }
										label={ __( 'Preview site actions' ) }
										className={ styles.previewActionsButton }
										disabled={ isDisabled }
									/>
								}
							/>
							<Menu.Popup side="bottom" align="end">
								<Menu.Item disabled={ isDisabled } onClick={ handleDelete }>
									{ deleteAllSnapshots.isPending
										? __( 'Deleting preview sites…' )
										: __( 'Delete all preview sites' ) }
								</Menu.Item>
							</Menu.Popup>
						</Menu.Root>
					</div>
				</div>
			) }
		</section>
	);
}

function AccountSettingsPanel() {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();
	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<div className={ styles.accountPanel }>
			<aside className={ styles.accountProfile }>
				{ user ? (
					<>
						<Gravatar
							email={ user.email }
							isDark={ themeIsDark }
							className={ styles.accountAvatar }
						/>
						<div className={ styles.accountDetails }>
							<h2>{ user.displayName }</h2>
							<p>{ user.email }</p>
						</div>
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							size="small"
							loading={ logout.isPending }
							loadingAnnouncement={ __( 'Logging out' ) }
							onClick={ () => logout.mutate() }
						>
							{ __( 'Log out' ) }
						</Button>
					</>
				) : (
					<>
						<div className={ styles.accountAvatarPlaceholder } aria-hidden="true" />
						<div className={ styles.accountDetails }>
							<h2>{ __( 'WordPress.com account' ) }</h2>
							<p>{ __( 'Log in to connect Studio with your WordPress.com account.' ) }</p>
						</div>
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							size="small"
							loading={ login.isPending }
							loadingAnnouncement={ __( 'Logging in' ) }
							onClick={ () => login.mutate() }
						>
							{ __( 'Log in' ) }
						</Button>
					</>
				) }
			</aside>
			<div className={ styles.accountOverview }>
				{ user ? <PreviewSitesSummary /> : null }
				{ user ? (
					<section className={ styles.accountOverviewSection }>
						<div className={ styles.accountOverviewHeader }>
							<h2>{ __( 'AI assistant' ) }</h2>
						</div>
						<p>{ __( 'Unlimited tokens while Studio Code is in beta.' ) }</p>
					</section>
				) : null }
				<section className={ styles.accountOverviewSection }>
					<div className={ styles.accountOverviewHeader }>
						<h2>{ __( 'Help' ) }</h2>
					</div>
					<p>{ __( 'Find Studio documentation or report an issue on GitHub.' ) }</p>
					<div className={ styles.accountActions }>
						<a
							className={ styles.externalLink }
							href={ DOCS_URL }
							onClick={ ( event ) => {
								event.preventDefault();
								openLink( DOCS_URL );
							} }
						>
							<span>{ __( 'Documentation' ) }</span>
							<Icon icon={ external } size={ 14 } aria-hidden="true" />
						</a>
						<a
							className={ styles.externalLink }
							href={ REPORT_ISSUE_URL }
							onClick={ ( event ) => {
								event.preventDefault();
								openLink( REPORT_ISSUE_URL );
							} }
						>
							<span>{ __( 'Report an issue' ) }</span>
							<Icon icon={ external } size={ 14 } aria-hidden="true" />
						</a>
					</div>
				</section>
			</div>
		</div>
	);
}

function getErrorMessage( error: unknown ): string | null {
	return error instanceof Error ? error.message : error ? String( error ) : null;
}

function SkillRow( {
	skill,
	actionLabel,
	busy,
	disabled,
	onAction,
}: {
	skill: SkillStatus;
	actionLabel: string;
	busy: boolean;
	disabled: boolean;
	onAction: () => void;
} ) {
	return (
		<li className={ styles.skillRow }>
			<div className={ styles.skillDetails }>
				<span className={ styles.skillName }>{ skill.displayName }</span>
				<span className={ styles.skillDescription }>{ skill.description }</span>
			</div>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				size="compact"
				disabled={ disabled }
				loading={ busy }
				loadingAnnouncement={ actionLabel }
				onClick={ onAction }
			>
				{ actionLabel }
			</Button>
		</li>
	);
}

function SkillSection( {
	title,
	headerAction,
	children,
}: {
	title: string;
	headerAction?: ReactNode;
	children: ReactNode;
} ) {
	return (
		<section className={ styles.skillSection }>
			<div className={ styles.skillSectionHeader }>
				<h2>{ title }</h2>
				{ headerAction ? (
					<div className={ styles.skillSectionAction }>{ headerAction }</div>
				) : null }
			</div>
			<ul className={ styles.skillList }>{ children }</ul>
		</section>
	);
}

function SkillsSettingsPanel() {
	const { data: skills, isLoading, error } = useWordPressSkills();
	const installSkill = useInstallWordPressSkill();
	const removeSkill = useRemoveWordPressSkill();
	const [ installingAll, setInstallingAll ] = useState( false );
	const installedSkills = useMemo(
		() => ( skills ?? [] ).filter( ( skill ) => skill.installed ),
		[ skills ]
	);
	const availableSkills = useMemo(
		() => ( skills ?? [] ).filter( ( skill ) => ! skill.installed ),
		[ skills ]
	);
	const isBusy = installSkill.isPending || removeSkill.isPending || installingAll;
	const visibleError =
		getErrorMessage( error ) ??
		getErrorMessage( installSkill.error ) ??
		getErrorMessage( removeSkill.error );

	const handleInstallAll = async () => {
		if ( availableSkills.length === 0 ) {
			return;
		}
		setInstallingAll( true );
		try {
			for ( const skill of availableSkills ) {
				await installSkill.mutateAsync( skill.id );
			}
		} finally {
			setInstallingAll( false );
		}
	};

	return (
		<div className={ styles.skillsPanel }>
			<p className={ styles.panelIntro }>
				{ __(
					'Select the skills that will be placed in all existing and new sites. Agents can decide to use skills to help them accomplish specialized tasks.'
				) }{ ' ' }
				<LearnMoreLink docsLinksKey="docsSkills" />
			</p>
			{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
			{ isLoading ? <div className={ styles.state }>{ __( 'Loading skills…' ) }</div> : null }
			{ installedSkills.length > 0 ? (
				<SkillSection title={ __( 'Installed' ) }>
					{ installedSkills.map( ( skill ) => (
						<SkillRow
							key={ skill.id }
							skill={ skill }
							actionLabel={ __( 'Remove' ) }
							busy={ removeSkill.isPending && removeSkill.variables === skill.id }
							disabled={ isBusy }
							onAction={ () => removeSkill.mutate( skill.id ) }
						/>
					) ) }
				</SkillSection>
			) : null }
			{ availableSkills.length > 0 ? (
				<SkillSection
					title={ __( 'Available' ) }
					headerAction={
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							size="compact"
							disabled={ isBusy }
							loading={ installingAll }
							loadingAnnouncement={ __( 'Installing all skills' ) }
							onClick={ () => void handleInstallAll() }
						>
							{ __( 'Install all' ) }
						</Button>
					}
				>
					{ availableSkills.map( ( skill ) => (
						<SkillRow
							key={ skill.id }
							skill={ skill }
							actionLabel={ __( 'Install' ) }
							busy={ installSkill.isPending && installSkill.variables === skill.id }
							disabled={ isBusy }
							onAction={ () => installSkill.mutate( skill.id ) }
						/>
					) ) }
				</SkillSection>
			) : null }
		</div>
	);
}

function McpSettingsPanel() {
	const configJson = getMcpServerConfigJson();
	const [ copied, setCopied ] = useState( false );
	const copiedTimeoutRef = useRef< number >( undefined );
	useEffect( () => () => window.clearTimeout( copiedTimeoutRef.current ), [] );
	const copyConfig = async () => {
		await navigator.clipboard?.writeText( configJson );
		setCopied( true );
		window.clearTimeout( copiedTimeoutRef.current );
		copiedTimeoutRef.current = window.setTimeout( () => setCopied( false ), 1600 );
	};

	return (
		<div className={ styles.mcpPanel }>
			<p className={ styles.panelIntro }>
				{ __(
					"Connect your AI coding assistant to the Studio MCP to let it create, configure, and interact with your local WordPress sites. Copy the JSON configuration below and add it to your assistant's MCP settings."
				) }{ ' ' }
				<LearnMoreLink docsLinksKey="docsMcp" />
			</p>
			<div className={ styles.codeBlockWrap }>
				<pre className={ styles.codeBlock }>{ configJson }</pre>
				<Button type="button" variant="outline" tone="neutral" onClick={ () => void copyConfig() }>
					{ copied ? __( 'Copied!' ) : __( 'Copy' ) }
				</Button>
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
	const { data: appGlobals } = useAppGlobals();
	const savePreferences = useSaveUserPreferences();
	const [ data, setData ] = useState< FormData | null >( null );
	const savedColorSchemeRef = useRef< ColorScheme >( 'light' );
	const hasUnsavedColorPreviewRef = useRef( false );

	useEffect( () => {
		if ( saved ) {
			setData( toFormData( saved ) );
			savedColorSchemeRef.current = saved.colorScheme;
		}
	}, [ saved ] );

	useEffect( () => {
		return () => {
			if ( hasUnsavedColorPreviewRef.current ) {
				void connector.previewColorScheme( savedColorSchemeRef.current );
			}
		};
	}, [ connector ] );

	const handleChange = useCallback( ( update: Record< string, unknown > ) => {
		setData( ( prev ) => ( prev ? { ...prev, ...( update as Partial< FormData > ) } : prev ) );
	}, [] );

	const handleColorSchemeChange = useCallback(
		( colorScheme: ColorScheme ) => {
			handleChange( { colorScheme } );
			hasUnsavedColorPreviewRef.current = true;
			void connector.previewColorScheme( colorScheme );
		},
		[ connector, handleChange ]
	);

	const handleDefaultSiteDirectorySelect = useCallback( async () => {
		const response = await connector.selectDefaultSiteDirectory( data?.defaultSiteDirectory ?? '' );
		if ( response?.path ) {
			handleChange( { defaultSiteDirectory: response.path } );
		}
	}, [ connector, data?.defaultSiteDirectory, handleChange ] );

	if ( isLoading || ! data || ! saved ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const patch = diffFromSaved( data, saved );
	const isDirty = Object.keys( patch ).length > 0;
	const canSubmit = isDirty && ! savePreferences.isPending;
	const showSaveButton = activeTab === 'preferences';

	const submitPreferences = () => {
		if ( ! canSubmit || ! showSaveButton ) return;
		// Translations are loaded once at bootstrap; the rest of the app imports
		// `__` from `@wordpress/i18n` directly and doesn't subscribe to locale
		// changes. Reload the window so every string re-renders in the new
		// language after a successful save.
		const localeChanged = 'locale' in patch;
		savePreferences.mutate( patch, {
			onSuccess: async () => {
				if ( 'colorScheme' in patch && patch.colorScheme ) {
					hasUnsavedColorPreviewRef.current = false;
					savedColorSchemeRef.current = patch.colorScheme;
				}
				if ( localeChanged ) {
					// The persister is throttled (~1s), so a fresh `setQueryData`
					// might not hit localStorage before we navigate. Drop the
					// persisted cache so the next mount refetches preferences
					// from the main process, which has the newly saved locale.
					await persister.removeClient();
					window.location.reload();
				}
			},
		} );
	};

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		submitPreferences();
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
				<SettingsHeader
					showSaveButton={ showSaveButton }
					canSubmit={ canSubmit }
					isSaving={ savePreferences.isPending }
					onSave={ submitPreferences }
				/>

				<div className={ styles.scroll }>
					<div className={ styles.contentBlock }>
						<form onSubmit={ handleSubmit } className={ styles.form }>
							<Tabs.Panel tabId="preferences" className={ styles.preferencesPanel }>
								<GeneralPreferencesSection
									data={ data }
									installedApps={ installedApps }
									messageSendShortcut={ data.messageSendShortcut }
									onColorSchemeChange={ handleColorSchemeChange }
									onDefaultSiteDirectorySelect={ () => void handleDefaultSiteDirectorySelect() }
									onChange={ handleChange }
								/>
								<KeyboardShortcutsSection />
								{ ! appGlobals?.isWindowsStore ? (
									<StudioCliSection
										checked={ data.studioCliInstalled }
										onChange={ ( studioCliInstalled ) => handleChange( { studioCliInstalled } ) }
									/>
								) : null }
							</Tabs.Panel>
							<Tabs.Panel tabId="account">
								<AccountSettingsPanel />
							</Tabs.Panel>
							<Tabs.Panel tabId="skills">
								<SkillsSettingsPanel />
							</Tabs.Panel>
							<Tabs.Panel tabId="mcp">
								<McpSettingsPanel />
							</Tabs.Panel>
						</form>
					</div>
				</div>
			</Tabs.Root>
		</div>
	);
}
