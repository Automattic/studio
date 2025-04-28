import { useState, useEffect } from 'react';
import { DEFAULT_EDITOR } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';

export function useEditorData() {
	const [ editor, setEditor ] = useState< SupportedEditor >( DEFAULT_EDITOR );
	const [ savedEditorValue, setSavedEditorValue ] = useState< SupportedEditor >( DEFAULT_EDITOR );

	const getSavedEditor = async () => {
		try {
			const savedEditor = await getIpcApi().getUserEditor();
			return savedEditor || DEFAULT_EDITOR;
		} catch ( error ) {
			return DEFAULT_EDITOR;
		}
	};

	useEffect( () => {
		const loadSavedEditor = async () => {
			const editor = await getSavedEditor();
			setSavedEditorValue( editor );
			setEditor( editor );
		};
		void loadSavedEditor();
	}, [] );

	const handleEditorChange = ( newEditor: SupportedEditor ) => {
		setEditor( newEditor );
	};

	const saveEditorPreference = async () => {
		await getIpcApi().saveUserEditor( editor );
	};

	const resetEditor = () => {
		setEditor( savedEditorValue );
	};

	const hasEditorChanges = editor !== savedEditorValue;

	return {
		editor,
		savedEditorValue,
		handleEditorChange,
		saveEditorPreference,
		resetEditor,
		hasEditorChanges,
		getSavedEditor,
	};
}
