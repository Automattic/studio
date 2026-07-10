import { SupportedLocale } from '@studio/common/lib/locale';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import { FormPathInputComponent } from 'src/components/form-path-input';
import { isWindowsStore } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { AnalyticsToggle } from 'src/modules/user-settings/components/analytics-toggle';
import { ColorSchemePicker } from 'src/modules/user-settings/components/color-scheme-picker';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';
import { StudioCliToggle } from 'src/modules/user-settings/components/studio-cli-toggle';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import { saveUserLocale } from 'src/stores/i18n-slice';
import {
	useGetColorSchemeQuery,
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveColorSchemeMutation,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
	useGetStudioCliIsInstalledQuery,
	useSaveStudioCliIsInstalledMutation,
	useGetDefaultSiteDirectoryQuery,
	useSaveDefaultSiteDirectoryMutation,
	useGetAnalyticsEnabledQuery,
	useSaveAnalyticsEnabledMutation,
} from 'src/stores/installed-apps-api';
import { SettingsFormField } from './settings-form-field';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const savedLocale = useI18nLocale();
	const dispatch = useAppDispatch();

	const { data: colorScheme } = useGetColorSchemeQuery();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const { data: isCliInstalled } = useGetStudioCliIsInstalledQuery();
	const { data: defaultSiteDirectory, isLoading: isLoadingDefaultSiteDirectory } =
		useGetDefaultSiteDirectoryQuery();
	const { data: analyticsEnabled } = useGetAnalyticsEnabledQuery();

	const [ saveColorSchemePreference ] = useSaveColorSchemeMutation();
	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();
	const [ saveCliIsInstalled ] = useSaveStudioCliIsInstalledMutation();
	const [ saveDefaultSiteDirectory ] = useSaveDefaultSiteDirectoryMutation();
	const [ saveAnalyticsEnabled ] = useSaveAnalyticsEnabledMutation();

	const [ dirtyColorScheme, setDirtyColorScheme ] = useState< 'system' | 'light' | 'dark' >();
	const [ dirtyLocale, setDirtyLocale ] = useState< SupportedLocale >();
	const [ dirtyEditor, setDirtyEditor ] = useState< SupportedEditor | null >();
	const [ dirtyTerminal, setDirtyTerminal ] = useState< SupportedTerminal >();
	const [ dirtyIsCliInstalled, setDirtyIsCliInstalled ] = useState< boolean >();
	const [ dirtyDefaultSiteDirectory, setDirtyDefaultSiteDirectory ] = useState< string >();
	const [ dirtyAnalyticsEnabled, setDirtyAnalyticsEnabled ] = useState< boolean >();

	const wasSavedRef = useRef( false );
	const dirtyColorSchemeRef = useRef( dirtyColorScheme );
	const savedColorSchemeRef = useRef( colorScheme );

	useEffect( () => {
		dirtyColorSchemeRef.current = dirtyColorScheme;
	}, [ dirtyColorScheme ] );

	useEffect( () => {
		savedColorSchemeRef.current = colorScheme;
	}, [ colorScheme ] );

	// Revert color scheme preview on unmount if not saved (handles Escape, click outside)
	useEffect( () => {
		return () => {
			if ( ! wasSavedRef.current && dirtyColorSchemeRef.current ) {
				void getIpcApi().previewColorScheme( savedColorSchemeRef.current ?? 'light' );
			}
		};
	}, [] );

	const handleColorSchemeChange = useCallback( ( scheme: 'system' | 'light' | 'dark' ) => {
		setDirtyColorScheme( scheme );
		void getIpcApi().previewColorScheme( scheme );
	}, [] );

	const savePreferences = async () => {
		wasSavedRef.current = true;
		if ( dirtyColorScheme ) {
			await saveColorSchemePreference( dirtyColorScheme );
		}
		if ( dirtyLocale ) {
			await dispatch( saveUserLocale( dirtyLocale ) );
		}
		if ( dirtyEditor ) {
			await saveEditor( dirtyEditor );
		}
		if ( dirtyTerminal ) {
			await saveTerminal( dirtyTerminal );
		}
		if ( dirtyIsCliInstalled !== undefined ) {
			await saveCliIsInstalled( dirtyIsCliInstalled );
		}
		if ( dirtyDefaultSiteDirectory ) {
			await saveDefaultSiteDirectory( dirtyDefaultSiteDirectory );
		}
		if ( dirtyAnalyticsEnabled !== undefined ) {
			await saveAnalyticsEnabled( dirtyAnalyticsEnabled );
		}
		onClose();
	};

	const colorSchemeSelection = dirtyColorScheme ?? colorScheme ?? 'light';
	const localeSelection = dirtyLocale ?? savedLocale ?? 'en';
	const editorSelection = dirtyEditor !== undefined ? dirtyEditor : editor ?? null;
	const terminalSelection = dirtyTerminal ?? terminal ?? 'terminal';
	const isCliInstalledSelection = dirtyIsCliInstalled ?? isCliInstalled ?? false;
	const defaultSiteDirectorySelection = dirtyDefaultSiteDirectory ?? defaultSiteDirectory ?? '';
	const analyticsEnabledSelection = dirtyAnalyticsEnabled ?? analyticsEnabled ?? true;

	const hasChanges = [
		[ dirtyColorScheme, colorScheme ],
		[ dirtyLocale, savedLocale ],
		[ dirtyEditor, editor ],
		[ dirtyTerminal, terminal ],
		[ dirtyIsCliInstalled, isCliInstalled ],
		[ dirtyDefaultSiteDirectory, defaultSiteDirectory ],
		[ dirtyAnalyticsEnabled, analyticsEnabled ],
	].some( ( [ a, b ] ) => a !== undefined && a !== b );

	const handleChangeDefaultDirectory = async () => {
		const response = await getIpcApi().showOpenFolderDialog(
			__( 'Select default site directory' ),
			defaultSiteDirectorySelection
		);
		if ( response?.path ) {
			setDirtyDefaultSiteDirectory( response.path );
		}
	};

	return (
		<>
			<ColorSchemePicker value={ colorSchemeSelection } onChange={ handleColorSchemeChange } />
			<LanguagePicker value={ localeSelection } onChange={ setDirtyLocale } />
			<div className="grid grid-cols-2 gap-3">
				<EditorPicker
					value={ editorSelection }
					onChange={ setDirtyEditor }
					disabled={ editor === undefined }
				/>
				<TerminalPicker value={ terminalSelection } onChange={ setDirtyTerminal } />
			</div>
			<SettingsFormField label={ __( 'Default site directory' ) }>
				<FormPathInputComponent
					value={ isLoadingDefaultSiteDirectory ? __( 'Loading…' ) : defaultSiteDirectorySelection }
					onClick={ handleChangeDefaultDirectory }
				/>
			</SettingsFormField>
			{ ! isWindowsStore() && (
				<StudioCliToggle value={ isCliInstalledSelection } onChange={ setDirtyIsCliInstalled } />
			) }
			<AnalyticsToggle value={ analyticsEnabledSelection } onChange={ setDirtyAnalyticsEnabled } />
			<div className="mt-auto pt-2 flex justify-end gap-3">
				<Button
					variant="tertiary"
					onClick={ () => onClose() }
					data-testid="preferences-cancel-button"
				>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ savePreferences }
					disabled={ ! hasChanges }
					data-testid="preferences-save-button"
				>
					{ __( 'Save' ) }
				</Button>
			</div>
		</>
	);
};
