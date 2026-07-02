import { supportedLocaleNames } from '@studio/common/lib/locale';
import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { FormToggle } from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { check, copy, file, Icon, moreHorizontal } from '@wordpress/icons';
import {
	Button,
	IconButton,
	InputControl,
	InputLayout,
	SelectControl,
	Tooltip,
} from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useOffline } from '@/hooks/use-offline';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import {
	UNSET,
	toPreferencesFormData,
	toPreferencesPatch,
	type PreferencesFormData,
} from './preferences';
import styles from './style.module.css';
import type {
	ColorScheme,
	InstalledApps,
	SkillStatus,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
} from '@/data/core';
import type { KeyboardEvent, ReactNode } from 'react';

const SETTINGS_TABS = [ 'preferences', 'usage', 'keyboard', 'skills', 'mcp' ] as const;

type TabId = ( typeof SETTINGS_TABS )[ number ];

export function isSettingsTab( value: string ): value is TabId {
	return SETTINGS_TABS.includes( value as TabId );
}

export function normalizeSettingsTab( value: string | undefined ): TabId {
	if ( value && isSettingsTab( value ) ) {
		return value;
	}
	return 'preferences';
}

export type SettingsTabId = TabId;

const DEFAULT_PREVIEW_SITE_LIMIT = 10;
const DOCS_URL = 'https://developer.wordpress.com/docs/developer-tools/studio/';
const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

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

function colorSchemeElements(): { value: ColorScheme; label: string }[] {
	return [
		{ value: 'system', label: __( 'System' ) },
		{ value: 'light', label: __( 'Light' ) },
		{ value: 'dark', label: __( 'Dark' ) },
	];
}

function isColorScheme( value: unknown ): value is ColorScheme {
	return value === 'system' || value === 'light' || value === 'dark';
}

const LOCALE_ELEMENTS: { value: SupportedLocale; label: string }[] = Object.entries(
	supportedLocaleNames
).map( ( [ value, label ] ) => ( { value: value as SupportedLocale, label } ) );

function SettingsHeader() {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
		: null;

	return (
		<div className={ clsx( styles.header, toggleSpacerClass && styles.headerWithSpacer ) }>
			{ toggleSpacerClass ? (
				<div className={ styles.headerStart }>
					<span className={ toggleSpacerClass } aria-hidden="true" />
				</div>
			) : null }
			<div className={ styles.headerTabs }>
				<Tabs.List className={ styles.headerTabList }>
					<Tabs.Tab tabId="preferences">{ __( 'Settings' ) }</Tabs.Tab>
					<Tabs.Tab tabId="usage">{ __( 'Usage' ) }</Tabs.Tab>
					<Tabs.Tab tabId="keyboard">{ __( 'Keyboard' ) }</Tabs.Tab>
					<Tabs.Tab tabId="skills">{ __( 'Skills' ) }</Tabs.Tab>
					<Tabs.Tab tabId="mcp">{ __( 'MCP' ) }</Tabs.Tab>
				</Tabs.List>
			</div>
			<div className={ styles.headerActions } />
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
	const options = colorSchemeElements();
	const activeIndex = Math.max(
		0,
		options.findIndex( ( option ) => option.value === value )
	);

	return (
		<PreferenceRow title={ __( 'Appearance' ) }>
			<div
				className={ styles.appearancePicker }
				role="group"
				aria-label={ __( 'Appearance' ) }
				data-active-index={ activeIndex }
			>
				{ options.map( ( option ) => (
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
	const chooseLabel = value
		? sprintf( __( 'Default site directory: %s. Choose a different folder.' ), value )
		: __( 'Choose a default site directory' );

	const handleKeyDown = ( event: KeyboardEvent< HTMLInputElement > ) => {
		if ( event.key === 'Enter' || event.key === ' ' ) {
			event.preventDefault();
			onSelect();
		}
	};

	return (
		<PreferenceRow title={ __( 'Default site directory' ) }>
			<InputControl
				hideLabelFromVision
				className={ styles.pathInputControl }
				label={ __( 'Default site directory' ) }
				placeholder={ __( 'Choose a folder...' ) }
				readOnly
				value={ value }
				onClick={ onSelect }
				onKeyDown={ handleKeyDown }
				suffix={
					<InputLayout.Slot padding="minimal">
						<IconButton
							type="button"
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ file }
							label={ chooseLabel }
							onClick={ ( event ) => {
								event.preventDefault();
								event.stopPropagation();
								onSelect();
							} }
						/>
					</InputLayout.Slot>
				}
			/>
		</PreferenceRow>
	);
}

function StudioCliSection( {
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: ( checked: boolean ) => void;
} ) {
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
					onChange={ ( event ) => onChange( event.target.checked ) }
				/>
			</div>
			<p className={ styles.cliDescription }>
				{ __( 'Use the studio command in any terminal to manage sites and run WP-CLI.' ) }{ ' ' }
				<LearnMoreLink docsLinksKey="docsCli" />
			</p>
		</section>
	);
}

function AgenticFeaturesSection( {
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: ( checked: boolean ) => void;
} ) {
	const connector = useConnector();
	const { data: user } = useAuthUser();

	// Signed-out users are gated by the sign-in state itself, and hosted mode
	// can't gate at all — the toggle only makes sense for signed-in desktop
	// users.
	if ( ! connector.supportsAgenticOptOut || ! user ) {
		return null;
	}

	return (
		<section className={ styles.preferenceSectionGroup }>
			<div className={ styles.cliHeader }>
				<h2 className={ clsx( styles.preferenceSectionHeading, styles.cliHeading ) }>
					{ __( 'Agentic features' ) }
				</h2>
				<FormToggle
					id="agentic-features-toggle"
					aria-label={ __( 'Agentic features' ) }
					checked={ checked }
					onChange={ ( event ) => onChange( event.target.checked ) }
				/>
			</div>
			<p className={ styles.cliDescription }>
				{ __(
					'Chat with an agent that builds and edits your sites. Turning this off hides chat — your existing conversations are kept.'
				) }
			</p>
		</section>
	);
}

function AccountInformationSection() {
	const { data: user, isLoading } = useAuthUser();
	const { data: preferences } = useUserPreferences();
	const login = useLogin();
	const logout = useLogout();
	const effectiveScheme = usePrefersColorScheme();
	const savedScheme = preferences?.colorScheme;
	const themeIsDark =
		savedScheme === 'dark' || ( savedScheme !== 'light' && effectiveScheme === 'dark' );

	return (
		<section className={ styles.preferenceSectionGroup }>
			<div className={ styles.accountSectionHeader }>
				<h2 className={ clsx( styles.preferenceSectionHeading, styles.accountHeading ) }>
					{ __( 'Account' ) }
				</h2>
				<AccountHelpActions />
			</div>
			<div className={ styles.accountSummaryHeader }>
				<div className={ styles.accountSummaryIdentity }>
					{ user ? (
						<Gravatar
							email={ user.email }
							isDark={ themeIsDark }
							className={ styles.accountSummaryAvatar }
						/>
					) : (
						<div className={ styles.accountSummaryAvatarPlaceholder } aria-hidden="true" />
					) }
					<div className={ styles.accountSummaryDetails }>
						<h2>{ user ? user.displayName : __( 'WordPress.com account' ) }</h2>
						<p>
							{ user
								? user.email
								: __( 'Log in to connect Studio with your WordPress.com account.' ) }
						</p>
					</div>
				</div>
				{ user ? (
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						loading={ logout.isPending }
						loadingAnnouncement={ __( 'Logging out' ) }
						onClick={ () => logout.mutate() }
					>
						{ __( 'Log out' ) }
					</Button>
				) : (
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						size="small"
						disabled={ isLoading }
						loading={ login.isPending }
						loadingAnnouncement={ __( 'Logging in' ) }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in' ) }
					</Button>
				) }
			</div>
		</section>
	);
}

function AccountHelpActions() {
	const connector = useConnector();

	const openLink = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	return (
		<div className={ styles.accountActions }>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				size="small"
				className={ styles.accountActionButton }
				onClick={ () => openLink( DOCS_URL ) }
			>
				{ __( 'Docs' ) }
			</Button>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				size="small"
				className={ styles.accountActionButton }
				onClick={ () => openLink( REPORT_ISSUE_URL ) }
			>
				{ __( 'Report an issue' ) }
			</Button>
		</div>
	);
}

function PreferencesPanel( {
	data,
	installedApps,
	showStudioCliToggle,
	showNativePreferences,
	onColorSchemeChange,
	onDefaultSiteDirectorySelect,
	onChange,
}: {
	data: PreferencesFormData;
	installedApps: InstalledApps | undefined;
	showStudioCliToggle: boolean;
	showNativePreferences: boolean;
	onColorSchemeChange: ( value: ColorScheme ) => void;
	onDefaultSiteDirectorySelect: () => void;
	onChange: ( update: Partial< PreferencesFormData > ) => void;
} ) {
	return (
		<div className={ styles.preferencesPanel }>
			<section className={ styles.preferenceSectionGroup }>
				<h2 className={ styles.preferenceSectionHeading }>{ __( 'General' ) }</h2>
				<AppearancePicker value={ data.colorScheme } onChange={ onColorSchemeChange } />
				<PreferenceRow title={ __( 'Language' ) }>
					<PreferenceSelect
						label={ __( 'Language' ) }
						value={ data.locale }
						options={ LOCALE_ELEMENTS }
						onChange={ ( locale ) => onChange( { locale } ) }
					/>
				</PreferenceRow>
				{ showNativePreferences ? (
					<>
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
					</>
				) : null }
			</section>
			<AccountInformationSection />
			<AgenticFeaturesSection
				checked={ data.agenticFeaturesEnabled }
				onChange={ ( agenticFeaturesEnabled ) => onChange( { agenticFeaturesEnabled } ) }
			/>
			{ showStudioCliToggle ? (
				<StudioCliSection
					checked={ data.studioCliInstalled }
					onChange={ ( studioCliInstalled ) => onChange( { studioCliInstalled } ) }
				/>
			) : null }
		</div>
	);
}

function PreviewSitesSummary( { userId }: { userId: number } ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const { data: snapshots, isLoading } = useSnapshots( userId );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useSnapshotUsage( userId );
	const deleteAllSnapshots = useDeleteAllSnapshots( userId );
	const siteCount = snapshotUsage?.siteCount ?? snapshots?.length ?? 0;
	const siteLimit = snapshotUsage?.siteLimit ?? DEFAULT_PREVIEW_SITE_LIMIT;
	const progressMax = Math.max( siteLimit, 1 );
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const isLoadingPreviewUsage = isLoading || isLoadingSnapshotUsage || deleteAllSnapshots.isPending;
	const isDisabled =
		siteCount === 0 || snapshotCreationBlocked || isLoadingPreviewUsage || isOffline;
	const progress = Math.min( siteCount / progressMax, 1 ) * 100;
	const deletePreviewSitesLabel = isOffline
		? __( 'Deleting preview sites requires an internet connection.' )
		: deleteAllSnapshots.isPending
		? __( 'Deleting preview sites...' )
		: __( 'Delete all preview sites' );

	const handleDelete = async () => {
		if ( isDisabled ) {
			return;
		}
		const confirmed = await connector.confirmDeleteAllPreviewSites();
		if ( confirmed ) {
			deleteAllSnapshots.mutate();
		}
	};

	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ __( 'Preview sites' ) }</h2>
				{ ! snapshotCreationBlocked ? (
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
							<Menu.Item disabled={ isDisabled } onClick={ () => void handleDelete() }>
								{ deletePreviewSitesLabel }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				) : null }
			</div>
			{ snapshotCreationBlocked ? (
				<div className={ styles.previewUsageText }>
					{ __( 'Preview sites are not available for your account.' ) }
				</div>
			) : (
				<>
					<div className={ styles.previewUsageText }>
						{ isLoadingPreviewUsage
							? __( 'Loading...' )
							: sprintf(
									/* translators: 1: number of active preview sites, 2: maximum allowed */
									_n(
										'%1$d of %2$d active preview site',
										'%1$d of %2$d active preview sites',
										siteCount
									),
									siteCount,
									siteLimit
							  ) }
					</div>
					<div className={ styles.progressTrack } aria-hidden="true">
						<div className={ styles.progressValue } style={ { inlineSize: `${ progress }%` } } />
					</div>
				</>
			) }
			{ deleteAllSnapshots.error ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while deleting preview sites. Please try again.' ) }
				</div>
			) : null }
		</section>
	);
}

function UsageSettingsPanel() {
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin();

	return (
		<div className={ styles.usagePanel }>
			<section className={ styles.settingsPanelSection }>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'Usage' ) }</h2>
					<p>{ __( 'Track your preview site usage and Studio Code beta credits.' ) }</p>
				</div>
				<section className={ styles.usageSection }>
					<div className={ styles.usageSectionHeader }>
						<h2>{ __( 'AI credits' ) }</h2>
						<span className={ styles.usageBadge }>{ __( 'Unlimited in beta' ) }</span>
					</div>
					<p>
						{ __(
							'AI credits are free and unlimited while Studio Code is in beta. Build, iterate, and experiment without watching a meter.'
						) }
					</p>
					<div className={ clsx( styles.progressTrack, styles.aiCreditsTrack ) } aria-hidden="true">
						<div className={ styles.aiCreditsMeterValue } />
					</div>
				</section>
				{ user ? (
					<PreviewSitesSummary userId={ user.id } />
				) : (
					<section className={ styles.usageSection }>
						<div className={ styles.usageSectionHeader }>
							<h2>{ __( 'Preview sites' ) }</h2>
						</div>
						<p>
							{ isLoading
								? __( 'Loading...' )
								: __( 'Log in to view preview site usage for your account.' ) }
						</p>
						{ ! isLoading ? (
							<Button
								type="button"
								variant="outline"
								tone="neutral"
								size="small"
								className={ styles.usageSectionAction }
								loading={ login.isPending }
								loadingAnnouncement={ __( 'Logging in' ) }
								onClick={ () => login.mutate() }
							>
								{ __( 'Log in' ) }
							</Button>
						) : null }
					</section>
				) }
			</section>
		</div>
	);
}

function getErrorMessage( error: unknown ): string | null {
	return error instanceof Error ? error.message : error ? String( error ) : null;
}

function getPlatformModifierKeyLabel(): string {
	if ( typeof navigator === 'undefined' ) {
		return 'Ctrl';
	}
	return /mac|iphone|ipad|ipod/i.test( navigator.platform || navigator.userAgent ) ? '⌘' : 'Ctrl';
}

function getShortcutKeyAriaLabel( key: string ): string {
	switch ( key ) {
		case '⌘':
			return __( 'Command' );
		case '↩':
			return __( 'Return' );
		case ',':
			return __( 'Comma' );
		case '[':
			return __( 'Left bracket' );
		case ']':
			return __( 'Right bracket' );
		default:
			return key;
	}
}

type KeyboardShortcut = {
	label: string;
	keys: string[];
};

type KeyboardShortcutSection = {
	title: string;
	shortcuts: KeyboardShortcut[];
};

function getKeyboardShortcutSections( modifierKey: string ): KeyboardShortcutSection[] {
	return [
		{
			title: __( 'General' ),
			shortcuts: [ { label: __( 'Open settings' ), keys: [ modifierKey, ',' ] } ],
		},
		{
			title: __( 'Composer' ),
			shortcuts: [
				{ label: __( 'Send message' ), keys: [ modifierKey, '↩' ] },
				{ label: __( 'Insert newline' ), keys: [ 'Shift', '↩' ] },
				{ label: __( 'Stop response' ), keys: [ 'Esc' ] },
			],
		},
		{
			title: __( 'Site preview' ),
			shortcuts: [
				{ label: __( 'Toggle site preview' ), keys: [ modifierKey, 'Shift', 'B' ] },
				{ label: __( 'Reload preview' ), keys: [ modifierKey, 'R' ] },
				{ label: __( 'Go back in preview' ), keys: [ modifierKey, '[' ] },
				{ label: __( 'Go forward in preview' ), keys: [ modifierKey, ']' ] },
			],
		},
	];
}

function ShortcutKeys( { keys }: { keys: string[] } ) {
	return (
		<span
			className={ styles.shortcutKeys }
			aria-label={ keys.map( getShortcutKeyAriaLabel ).join( ' + ' ) }
		>
			{ keys.map( ( key, index ) => (
				<kbd key={ `${ key }-${ index }` } className={ styles.shortcutKey } aria-hidden="true">
					{ key }
				</kbd>
			) ) }
		</span>
	);
}

function KeyboardShortcutGroup( { title, shortcuts }: KeyboardShortcutSection ) {
	return (
		<section className={ styles.shortcutSection }>
			<div className={ styles.shortcutSectionHeader }>
				<h2>{ title }</h2>
			</div>
			<ul className={ styles.shortcutList }>
				{ shortcuts.map( ( shortcut ) => (
					<li key={ shortcut.label } className={ styles.shortcutRow }>
						<span className={ styles.shortcutName }>{ shortcut.label }</span>
						<ShortcutKeys keys={ shortcut.keys } />
					</li>
				) ) }
			</ul>
		</section>
	);
}

function KeyboardSettingsPanel() {
	const shortcutSections = getKeyboardShortcutSections( getPlatformModifierKeyLabel() );

	return (
		<div className={ styles.keyboardPanel }>
			<section className={ styles.settingsPanelSection }>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'Keyboard shortcuts' ) }</h2>
					<p>{ __( 'Use these keyboard shortcuts to move faster around Studio.' ) }</p>
				</div>
				{ shortcutSections.map( ( section ) => (
					<KeyboardShortcutGroup
						key={ section.title }
						title={ section.title }
						shortcuts={ section.shortcuts }
					/>
				) ) }
			</section>
		</div>
	);
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
				size="small"
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
			<section className={ styles.settingsPanelSection }>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'Skills' ) }</h2>
					<p>
						{ __(
							'Skills are reusable instructions that teach agents how to complete specialized WordPress tasks. Enable the ones you want Studio to add to sites so agents have the right context before they start working.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsSkills" />
					</p>
				</div>
				{ visibleError ? <div className={ styles.errorMessage }>{ visibleError }</div> : null }
				{ isLoading ? <div className={ styles.state }>{ __( 'Loading skills...' ) }</div> : null }
				{ ! isLoading && installedSkills.length === 0 && availableSkills.length === 0 ? (
					<div className={ styles.state }>{ __( 'No skills are available.' ) }</div>
				) : null }
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
								size="small"
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
			</section>
		</div>
	);
}

function McpCopyButton( { text }: { text: string } ) {
	const connector = useConnector();
	const [ copied, setCopied ] = useState( false );

	useEffect( () => {
		if ( ! copied ) {
			return;
		}
		const timeoutId = window.setTimeout( () => setCopied( false ), 2000 );
		return () => window.clearTimeout( timeoutId );
	}, [ copied ] );

	const copyLabel = __( 'Copy MCP configuration' );
	const copiedLabel = __( 'Copied' );
	const tooltipLabel = copied ? copiedLabel : copyLabel;

	const handleCopy = useCallback( () => {
		void connector.copyText( text );
		setCopied( true );
	}, [ connector, text ] );

	return (
		<div className={ styles.mcpCopyButtonContainer }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ styles.mcpCopyButton }
							onClick={ handleCopy }
							aria-label={ copyLabel }
						>
							<Icon
								icon={ copied ? check : copy }
								size={ 16 }
								fill="currentColor"
								aria-hidden="true"
							/>
						</button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ tooltipLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</div>
	);
}

function McpSettingsPanel() {
	const configJson = getMcpServerConfigJson();

	return (
		<div className={ styles.mcpPanel }>
			<section className={ styles.settingsPanelSection }>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'MCP' ) }</h2>
					<p>
						{ __(
							'MCP lets other AI tools talk to Studio. Use it when you want an assistant outside Studio to create, configure, or inspect your local WordPress sites through the same site controls.'
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsMcp" />
					</p>
				</div>
				<div className={ styles.codeBlockWrap }>
					<pre className={ styles.codeBlock }>{ configJson }</pre>
					<McpCopyButton text={ configJson } />
				</div>
			</section>
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
						window.location.reload();
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
		return <div className={ styles.state }>{ __( 'Loading...' ) }</div>;
	}

	const showNativePreferences = appGlobals?.platform !== 'browser';
	const showStudioCliToggle = showNativePreferences && appGlobals?.isWindowsStore === false;

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
						<div className={ styles.form }>
							<Tabs.Panel tabId="preferences">
								<PreferencesPanel
									data={ data }
									installedApps={ installedApps }
									showStudioCliToggle={ showStudioCliToggle }
									showNativePreferences={ showNativePreferences }
									onColorSchemeChange={ handleColorSchemeChange }
									onDefaultSiteDirectorySelect={ () => void handleSelectDefaultDirectory() }
									onChange={ handleChange }
								/>
							</Tabs.Panel>
							<Tabs.Panel tabId="usage">
								<UsageSettingsPanel />
							</Tabs.Panel>
							<Tabs.Panel tabId="keyboard">
								<KeyboardSettingsPanel />
							</Tabs.Panel>
							<Tabs.Panel tabId="skills">
								<SkillsSettingsPanel />
							</Tabs.Panel>
							<Tabs.Panel tabId="mcp">
								<McpSettingsPanel />
							</Tabs.Panel>
						</div>
					</div>
				</div>
			</Tabs.Root>
		</div>
	);
}
