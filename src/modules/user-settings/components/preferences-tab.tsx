import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { useI18nData } from 'src/hooks/use-i18n-data';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import {
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
} from 'src/stores/installed-apps-api';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const { locale: savedLocale, setLocale: setSavedLocale } = useI18nData();
	const [ locale, setLocale ] = useState( savedLocale );

	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal = 'terminal' } = useGetUserTerminalQuery();
	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();

	const [ currentEditor, setCurrentEditor ] = useState< SupportedEditor | null >( editor ?? null );
	const [ currentTerminal, setCurrentTerminal ] = useState( terminal );

	const savePreferences = async () => {
		await setSavedLocale( locale );
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
				<Button variant="tertiary" onClick={ cancelChanges }>
					{ __( 'Cancel' ) }
				</Button>
				<Button variant="primary" onClick={ savePreferences } disabled={ ! hasChanges }>
					{ __( 'Save' ) }
				</Button>
			</div>
		</>
	);
};
