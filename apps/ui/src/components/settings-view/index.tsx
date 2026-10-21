import { supportedLocaleNames } from '@studio/common/lib/locale';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { CheckboxControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { SelectControl } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { persister } from '@/data/core/query-client';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AccountSection } from './account-section';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import { StudioCliSection } from './studio-cli-section';
import styles from './style.module.css';
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

function PreferenceRow( {
	title,
	description,
	children,
}: {
	title: string;
	description?: ReactNode;
	children?: ReactNode;
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
		<PreferenceRow title={ __( 'Theme' ) } description={ __( 'Choose light, dark, or system.' ) }>
			<div
				className={ styles.appearancePicker }
				role="group"
				aria-label={ __( 'Theme' ) }
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

function DefaultSiteDirectoryField( {
	value,
	onSelect,
}: {
	value: string;
	onSelect?: () => void;
} ) {
	// Without a native folder picker (the browser), the path is shown, not edited.
	if ( ! onSelect ) {
		return <PreferenceRow title={ __( 'Default site directory' ) } description={ value } />;
	}
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
	return (
		<div className={ styles.preferencesPanel }>
			<AccountSection />
			<section className={ styles.preferenceSectionGroup }>
				{ saveError ? (
					<div className={ styles.errorMessage }>
						{ __( 'An error occurred while saving settings. Please try again.' ) }
					</div>
				) : null }
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
				<PreferenceRow
					title={ __( 'Usage statistics' ) }
					description={ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
				>
					<CheckboxControl
						__nextHasNoMarginBottom
						label=""
						aria-label={ __( 'Usage statistics' ) }
						checked={ data.analyticsEnabled }
						onChange={ ( analyticsEnabled ) => onChange( { analyticsEnabled } ) }
					/>
				</PreferenceRow>
			</section>
			<WapuuScore />
			<StudioCliSection />
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

export function AppearanceSettings() {
	const { data, handleChange, loadFailed } = usePreferencesForm();
	if ( ! data ) {
		return <PreferencesState loadFailed={ loadFailed } />;
	}
	return (
		<section className={ styles.preferenceSectionGroup }>
			<AppearancePicker
				value={ data.colorScheme }
				onChange={ ( colorScheme ) => handleChange( { colorScheme } ) }
			/>
		</section>
	);
}

export { AiPanel } from './ai-panel';
export { KeyboardPanel } from './keyboard-panel';
export { McpPanel } from './mcp-panel';
export { SkillsPanel } from './skills-panel';
export { UsagePanel } from './usage-panel';
