import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';

export function useEditorData() {
	const [ editor, setEditor ] = useState< SupportedEditor | string >( '' );
	const [ savedEditorValue, setSavedEditorValue ] = useState< SupportedEditor | string >( '' );

	const getSavedEditor = async () => {
		try {
			const savedEditor = await getIpcApi().getUserEditor();
			// Respect user preference if it is set
			if ( savedEditor ) {
				return savedEditor;
			}

			// If no user preference is set, check for installed editors
			// and set the default to the first one found
			// This is a fallback to ensure we keep existing behavior
			const installedEditors = await getIpcApi().getInstalledApps();
			if ( installedEditors.vscode ) {
				return 'vscode';
			} else if ( installedEditors.phpstorm ) {
				return 'phpstorm';
			}

			return '';
		} catch ( error ) {
			return '';
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

	const handleEditorChange = ( newEditor: SupportedEditor | string ) => {
		setEditor( newEditor );
	};

	const saveEditorPreference = async () => {
		await getIpcApi().saveUserEditor( editor as SupportedEditor );
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
