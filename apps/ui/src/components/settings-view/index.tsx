import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { DataForm } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tabs from '@/components/tabs';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type {
	ColorScheme,
	InstalledApps,
	SupportedEditor,
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
}

function toFormData( prefs: UserPreferences ): FormData {
	return {
		editor: prefs.editor ?? UNSET,
		terminal: prefs.terminal ?? UNSET,
		colorScheme: prefs.colorScheme,
	};
}

function diffFromSaved(
	next: FormData,
	saved: UserPreferences
): Partial< WritableUserPreferences > {
	const patch: Partial< WritableUserPreferences > = {};
	const nextEditor: SupportedEditor | null = next.editor === UNSET ? null : next.editor;
	const nextTerminal: SupportedTerminal | null = next.terminal === UNSET ? null : next.terminal;
	if ( nextEditor !== saved.editor ) patch.editor = nextEditor;
	if ( nextTerminal !== saved.terminal ) patch.terminal = nextTerminal;
	if ( next.colorScheme !== saved.colorScheme ) patch.colorScheme = next.colorScheme;
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

function SettingsHeader() {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const toggleSpacerClass = sidebarCollapsed
		? isFullscreen
			? styles.toggleSpacerFullscreen
			: styles.toggleSpacer
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
		],
		[ installedApps ]
	);

	const preferencesForm = useMemo< Form >(
		() => ( {
			layout: { type: 'regular', labelPosition: 'top' },
			fields: [ 'editor', 'terminal', 'colorScheme' ],
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
		savePreferences.mutate( patch );
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
