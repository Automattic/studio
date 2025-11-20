import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import { saveUserLocale } from 'src/stores/i18n-slice';
import {
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
} from 'src/stores/installed-apps-api';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const savedLocale = useI18nLocale();
	const dispatch = useAppDispatch();
	const [ locale, setLocale ] = useState( savedLocale );

	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal = 'terminal' } = useGetUserTerminalQuery();
	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();

	const [ currentEditor, setCurrentEditor ] = useState< SupportedEditor | null >( editor ?? null );
	const [ currentTerminal, setCurrentTerminal ] = useState( terminal );

	const savePreferences = async () => {
		await dispatch( saveUserLocale( locale ) );
		if ( currentEditor ) {
			await saveEditor( currentEditor );
		}
		await saveTerminal( currentTerminal );
		onClose();
	};

	const cancelChanges = () => {
		setLocale( savedLocale );
		setCurrentEditor( editor ?? null );
		setCurrentTerminal( terminal );
		onClose();
	};

	const hasChanges =
		locale !== savedLocale || currentEditor !== editor || currentTerminal !== terminal;

	return (
		<>
			<LanguagePicker value={ locale } onChange={ setLocale } />
			<EditorPicker
				value={ currentEditor }
				onChange={ setCurrentEditor }
				disabled={ editor === undefined }
			/>
			<TerminalPicker value={ currentTerminal } onChange={ setCurrentTerminal } />
			<div className="mt-auto pt-2 flex justify-end gap-3">
				<Button
					variant="tertiary"
					onClick={ cancelChanges }
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
