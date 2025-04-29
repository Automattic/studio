import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';

export function useEditorData() {
	const [ editor, setEditor ] = useState< SupportedEditor | undefined >();
	const [ savedEditorValue, setSavedEditorValue ] = useState< SupportedEditor | undefined >();

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

			return undefined;
		} catch ( error ) {
			return undefined;
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

	const handleEditorChange = ( newEditor: SupportedEditor | undefined ) => {
		setEditor( newEditor );
	};

	const saveEditorPreference = async () => {
		if ( editor ) {
			await getIpcApi().saveUserEditor( editor );
		}
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
