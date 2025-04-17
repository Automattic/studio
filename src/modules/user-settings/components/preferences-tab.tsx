import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { EditorPicker } from 'src/components/editor-picker';
import { TerminalPicker } from 'src/components/terminal-picker';
import { useEditorData } from 'src/hooks/use-editor-data';
import { useI18nData } from 'src/hooks/use-i18n-data';
import { useTerminalData } from 'src/hooks/use-terminal-data';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const { locale: savedLocale, setLocale: setSavedLocale } = useI18nData();
	const [ locale, setLocale ] = useState( savedLocale );

	const { editor, handleEditorChange, saveEditorPreference, resetEditor, hasEditorChanges } =
		useEditorData();
	const {
		terminal,
		handleTerminalChange,
		saveTerminalPreference,
		resetTerminal,
		hasTerminalChanges,
		availableTerminals,
	} = useTerminalData();

	const savePreferences = async () => {
		setSavedLocale( locale );
		await saveEditorPreference();
		await saveTerminalPreference();
		onClose();
	};

	const cancelChanges = () => {
		setLocale( savedLocale );
		resetEditor();
		resetTerminal();
		onClose();
	};

	const hasChanges = locale !== savedLocale || hasEditorChanges || hasTerminalChanges;

	return (
		<>
			<LanguagePicker value={ locale } onChange={ setLocale } />
			<EditorPicker value={ editor } onChange={ handleEditorChange } />
			<TerminalPicker
				value={ terminal }
				onChange={ handleTerminalChange }
				availableTerminals={ availableTerminals }
			/>
			<div className="mt-auto pt-6 flex justify-end gap-3">
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
