import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import { SupportedEditor, supportedEditorNames } from 'src/lib/editor';

interface EditorPickerProps {
	value: SupportedEditor;
	onChange: ( value: SupportedEditor ) => void;
}

export const EditorPicker = ( { value, onChange }: EditorPickerProps ) => {
	const { __ } = useI18n();
	const [ installedApps, setInstalledApps ] = useState< {
		vscode: boolean | null;
		phpstorm: boolean | null;
	} >( {
		vscode: null,
		phpstorm: null,
	} );

	useEffect( () => {
		const fetchInstalledApps = async () => {
			try {
				const apps = await window.ipcApi.getInstalledApps();
				setInstalledApps( apps );
			} catch ( error ) {
				console.error( 'Failed to fetch installed apps:', error );
			}
		};

		fetchInstalledApps();
	}, [] );

	const options = Object.entries( supportedEditorNames ).map( ( [ editor, label ] ) => {
		const editorKey = editor as SupportedEditor;
		const isInstalled =
			editorKey === 'none' || installedApps[ editorKey as keyof typeof installedApps ];

		return {
			value: editorKey,
			label,
			disabled: editorKey !== 'none' && ! isInstalled,
		};
	} );

	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Editor' ) }</h2>
			<SelectControl
				value={ value || 'none' }
				onChange={ onChange }
				options={ options }
				__nextHasNoMarginBottom
				className="mb-2"
			/>
		</div>
	);
};
