import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';

export function useEditorData() {
	const [ editor, setEditor ] = useState< SupportedEditor >( 'vscode' );
	const [ savedEditorValue, setSavedEditorValue ] = useState< SupportedEditor >( 'vscode' );

	const getSavedEditor = async () => {
		try {
			const savedEditor = await getIpcApi().getUserEditor();
			return savedEditor;
		} catch ( error ) {
			return 'vscode';
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
	};
}
