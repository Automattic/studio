import { SupportedLocale } from '@studio/common/lib/locale';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import { DotGrid } from 'src/components/dot-grid';
import { FormPathInputComponent } from 'src/components/form-path-input';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { isWindowsStore } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
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
} from 'src/stores/installed-apps-api';
import { SettingsFormField } from './settings-form-field';

function AgenticUiCallout() {
	const { __ } = useI18n();
	const { enableAgenticUi } = useFeatureFlags();
	const betaFeatures = useBetaFeatures();

	if ( ! enableAgenticUi || betaFeatures.enableAgenticUi ) {
		return null;
	}

	return (
		<div className="relative overflow-hidden rounded-md p-4 border border-[var(--color-frame-border)] bg-[var(--color-frame-bg)]">
			<DotGrid
				spacing={ 16 }
				crossSize={ 3 }
				opacity={ 0.2 }
				className="text-frame-text-secondary"
			/>
			<div className="relative flex items-center justify-between gap-4">
				<div>
					<p className="m-0 font-semibold text-[var(--color-frame-text)]">
						{ __( 'There’s a new way to build in Studio' ) }
					</p>
					<p className="m-0 mt-1 text-xs text-[var(--color-frame-text-secondary)]">
						{ __(
							'A redesigned interface with AI-powered site building. You can switch back anytime.'
						) }
					</p>
				</div>
				<Button variant="primary" onClick={ () => getIpcApi().enableAgenticUi() }>
					{ __( 'Try it' ) }
				</Button>
			</div>
		</div>
	);
}

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

	const [ saveColorSchemePreference ] = useSaveColorSchemeMutation();
	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();
	const [ saveCliIsInstalled ] = useSaveStudioCliIsInstalledMutation();
	const [ saveDefaultSiteDirectory ] = useSaveDefaultSiteDirectoryMutation();

	const [ dirtyColorScheme, setDirtyColorScheme ] = useState< 'system' | 'light' | 'dark' >();
	const [ dirtyLocale, setDirtyLocale ] = useState< SupportedLocale >();
	const [ dirtyEditor, setDirtyEditor ] = useState< SupportedEditor | null >();
	const [ dirtyTerminal, setDirtyTerminal ] = useState< SupportedTerminal >();
	const [ dirtyIsCliInstalled, setDirtyIsCliInstalled ] = useState< boolean >();
	const [ dirtyDefaultSiteDirectory, setDirtyDefaultSiteDirectory ] = useState< string >();

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
		onClose();
	};

	const colorSchemeSelection = dirtyColorScheme ?? colorScheme ?? 'light';
	const localeSelection = dirtyLocale ?? savedLocale ?? 'en';
	const editorSelection = dirtyEditor !== undefined ? dirtyEditor : editor ?? null;
	const terminalSelection = dirtyTerminal ?? terminal ?? 'terminal';
	const isCliInstalledSelection = dirtyIsCliInstalled ?? isCliInstalled ?? false;
	const defaultSiteDirectorySelection = dirtyDefaultSiteDirectory ?? defaultSiteDirectory ?? '';

	const hasChanges = [
		[ dirtyColorScheme, colorScheme ],
		[ dirtyLocale, savedLocale ],
		[ dirtyEditor, editor ],
		[ dirtyTerminal, terminal ],
		[ dirtyIsCliInstalled, isCliInstalled ],
		[ dirtyDefaultSiteDirectory, defaultSiteDirectory ],
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
			<AgenticUiCallout />
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
