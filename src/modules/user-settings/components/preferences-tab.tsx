import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import { EditorPicker } from 'src/components/editor-picker';
import { LanguagePicker } from 'src/components/language-picker';
import { useEditorData } from 'src/hooks/use-editor-data';
import { useI18nData } from 'src/hooks/use-i18n-data';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const { locale: savedLocale, setLocale: setSavedLocale } = useI18nData();
	const [ locale, setLocale ] = useState( savedLocale );

	const { editor, handleEditorChange, saveEditorPreference, resetEditor, hasEditorChanges } =
		useEditorData();

	const savePreferences = async () => {
		setSavedLocale( locale );
		await saveEditorPreference();
		onClose();
	};

	const cancelChanges = () => {
		setLocale( savedLocale );
		resetEditor();
		onClose();
	};

	const hasChanges = locale !== savedLocale || hasEditorChanges;

	return (
		<>
			<LanguagePicker value={ locale } onChange={ setLocale } />
			<EditorPicker value={ editor } onChange={ handleEditorChange } />
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
