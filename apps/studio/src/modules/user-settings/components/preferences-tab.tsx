import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { SupportedLocale } from '@studio/common/lib/locale';
import Button from 'src/components/button';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';
import { StudioCliToggle } from 'src/modules/user-settings/components/studio-cli-toggle';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import { saveUserLocale } from 'src/stores/i18n-slice';
import {
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
	useGetStudioCliIsInstalledQuery,
	useSaveStudioCliIsInstalledMutation,
} from 'src/stores/installed-apps-api';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const savedLocale = useI18nLocale();
	const dispatch = useAppDispatch();

	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const { data: isCliInstalled } = useGetStudioCliIsInstalledQuery();

	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();
	const [ saveCliIsInstalled ] = useSaveStudioCliIsInstalledMutation();

	const [ dirtyLocale, setDirtyLocale ] = useState< SupportedLocale >();
	const [ dirtyEditor, setDirtyEditor ] = useState< SupportedEditor | null >();
	const [ dirtyTerminal, setDirtyTerminal ] = useState< SupportedTerminal >();
	const [ dirtyIsCliInstalled, setDirtyIsCliInstalled ] = useState< boolean >();

	const savePreferences = async () => {
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
		onClose();
	};

	const localeSelection = dirtyLocale ?? savedLocale ?? 'en';
	const editorSelection = dirtyEditor ?? editor ?? 'vscode';
	const terminalSelection = dirtyTerminal ?? terminal ?? 'terminal';
	const isCliInstalledSelection = dirtyIsCliInstalled ?? isCliInstalled ?? false;

	const hasChanges = [
		[ dirtyLocale, savedLocale ],
		[ dirtyEditor, editor ],
		[ dirtyTerminal, terminal ],
		[ dirtyIsCliInstalled, isCliInstalled ],
	].some( ( [ a, b ] ) => a !== undefined && a !== b );

	return (
		<>
			<LanguagePicker value={ localeSelection } onChange={ setDirtyLocale } />
			<EditorPicker
				value={ editorSelection }
				onChange={ setDirtyEditor }
				disabled={ editor === undefined }
			/>
			<TerminalPicker value={ terminalSelection } onChange={ setDirtyTerminal } />
			<StudioCliToggle value={ isCliInstalledSelection } onChange={ setDirtyIsCliInstalled } />
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
