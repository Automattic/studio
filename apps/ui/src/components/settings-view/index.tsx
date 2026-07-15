import { isSupportedLocale, supportedLocaleNames } from '@studio/common/lib/locale';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { DataForm } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tabs from '@/components/tabs';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';
import type {
	ColorScheme,
	InstalledApps,
	QuitSitesBehavior,
	SupportedEditor,
	SupportedLocale,
	SupportedTerminal,
	UserPreferences,
	WritableUserPreferences,
} from '@/data/core';
import type { Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

type TabId = 'preferences';

export function isSettingsTab( value: string ): value is TabId {
	return value === 'preferences';
}

export type SettingsTabId = TabId;

// Empty-string sentinel for "not set" — DataForm's select-style fields need a
// primitive value, so we can't use null directly.
const UNSET = '' as const;

interface FormData {
	editor: SupportedEditor | typeof UNSET;
	terminal: SupportedTerminal | typeof UNSET;
	colorScheme: ColorScheme;
	quitSitesBehavior: QuitSitesBehavior | typeof UNSET;
	locale: SupportedLocale;
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
		quitSitesBehavior: prefs.quitSitesBehavior ?? UNSET,
		locale: resolveFormLocale( prefs.locale ),
	};
}

function diffFromSaved(
	next: FormData,
	saved: UserPreferences
): Partial< WritableUserPreferences > {
	const patch: Partial< WritableUserPreferences > = {};
	const nextEditor: SupportedEditor | null = next.editor === UNSET ? null : next.editor;
	const nextTerminal: SupportedTerminal | null = next.terminal === UNSET ? null : next.terminal;
	const nextQuitSitesBehavior: QuitSitesBehavior | undefined =
		next.quitSitesBehavior === UNSET ? undefined : next.quitSitesBehavior;
	if ( nextEditor !== saved.editor ) patch.editor = nextEditor;
	if ( nextTerminal !== saved.terminal ) patch.terminal = nextTerminal;
	if ( next.colorScheme !== saved.colorScheme ) patch.colorScheme = next.colorScheme;
	if ( nextQuitSitesBehavior !== saved.quitSitesBehavior ) {
		patch.quitSitesBehavior = nextQuitSitesBehavior;
	}
	if ( next.locale !== resolveFormLocale( saved.locale ) ) patch.locale = next.locale;
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

const COLOR_SCHEME_ELEMENTS: { value: ColorScheme; label: string }[] = [
	{ value: 'system', label: __( 'System' ) },
	{ value: 'light', label: __( 'Light' ) },
	{ value: 'dark', label: __( 'Dark' ) },
];

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
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const toggleSpacerClass = sidebarCollapsed
		? reserveTrafficLightSpace
			? styles.toggleSpacer
			: styles.toggleSpacerFlush
		: null;
	return (
		<div className={ styles.header }>
			{ toggleSpacerClass ? <span className={ toggleSpacerClass } aria-hidden="true" /> : null }
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
	const { data: saved, isLoading } = useUserPreferences();
	const { data: installedApps } = useInstalledApps();
	const savePreferences = useSaveUserPreferences();

	const [ data, setData ] = useState< FormData | null >( null );
	useEffect( () => {
		if ( saved ) {
			setData( toFormData( saved ) );
		}
	}, [ saved ] );

	const preferencesFields = useMemo< Field< FormData >[] >(
		() => [
			{
				id: 'editor',
				type: 'text',
				label: __( 'Preferred editor' ),
				elements: editorElements( installedApps ),
			},
			{
				id: 'terminal',
				type: 'text',
				label: __( 'Preferred terminal' ),
				elements: terminalElements( installedApps ),
			},
			{
				id: 'colorScheme',
				type: 'text',
				label: __( 'Appearance' ),
				elements: COLOR_SCHEME_ELEMENTS,
			},
			{
				id: 'locale',
				type: 'text',
				label: __( 'Language' ),
				elements: LOCALE_ELEMENTS,
				// Force the native <select>. DataForm otherwise uses a clearable
				// combobox for 10+ options, whose "x" could empty the language.
				Edit: 'select',
			},
			{
				id: 'quitSitesBehavior',
				type: 'text',
				label: __( 'When quitting with running sites' ),
				elements: QUIT_SITES_BEHAVIOR_ELEMENTS,
			},
		],
		[ installedApps ]
	);

	const preferencesForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [
				{
					id: 'apps',
					layout: { type: 'row' },
					children: [ 'editor', 'terminal' ],
				},
				'colorScheme',
				'locale',
				'quitSitesBehavior',
			],
		} ),
		[]
	);

	const handleChange = useCallback( ( update: Record< string, unknown > ) => {
		setData( ( prev ) => ( prev ? { ...prev, ...( update as Partial< FormData > ) } : prev ) );
	}, [] );

	if ( isLoading || ! data || ! saved ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}

	const patch = diffFromSaved( data, saved );
	const isDirty = Object.keys( patch ).length > 0;
	const canSubmit = isDirty && ! savePreferences.isPending;

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! canSubmit ) return;
		// Translations are loaded once at bootstrap; the rest of the app imports
		// `__` from `@wordpress/i18n` directly and doesn't subscribe to locale
		// changes. Reload the window so every string re-renders in the new
		// language after a successful save.
		const localeChanged = 'locale' in patch;
		savePreferences.mutate( patch, {
			onSuccess: async () => {
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

	return (
		<div className={ styles.root }>
			<SettingsHeader />
			<Tabs.Root
				selectedTabId={ activeTab }
				onSelect={ ( tabId ) => {
					if ( tabId && isSettingsTab( tabId ) ) {
						onTabChange( tabId );
					}
				} }
			>
				<div className={ styles.titleBlock }>
					<h1>{ __( 'Settings' ) }</h1>
				</div>
				<div className={ styles.tabsBar }>
					<div className={ styles.tabsBarInner }>
						<Tabs.List>
							<Tabs.Tab tabId="preferences">{ __( 'Preferences' ) }</Tabs.Tab>
						</Tabs.List>
					</div>
				</div>

				<div className={ styles.scroll }>
					<div className={ styles.contentBlock }>
						<form onSubmit={ handleSubmit } className={ styles.form }>
							<Tabs.Panel tabId="preferences">
								<DataForm< FormData >
									data={ data }
									fields={ preferencesFields }
									form={ preferencesForm }
									onChange={ handleChange }
								/>
							</Tabs.Panel>

							<div className={ styles.actions }>
								<Button
									type="submit"
									variant="solid"
									tone="brand"
									disabled={ ! canSubmit }
									loading={ savePreferences.isPending }
									loadingAnnouncement={ __( 'Saving settings' ) }
								>
									{ __( 'Save settings' ) }
								</Button>
							</div>
						</form>
					</div>
				</div>
			</Tabs.Root>
		</div>
	);
}
