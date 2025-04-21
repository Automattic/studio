import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import { SupportedEditor, supportedEditorNames } from 'src/lib/editor';
import { getIpcApi } from 'src/lib/get-ipc-api';

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
				const apps = await getIpcApi().getInstalledApps();
				setInstalledApps( apps );
			} catch ( error ) {
				console.error( 'Failed to fetch installed apps:', error );
			}
		};

		fetchInstalledApps();
	}, [] );

	const installedEditors = Object.entries( supportedEditorNames ).filter(
		( [ editor ] ) => installedApps[ editor as keyof typeof installedApps ]
	);

	const uninstalledEditors = Object.entries( supportedEditorNames ).filter(
		( [ editor ] ) => ! installedApps[ editor as keyof typeof installedApps ]
	);

	return (
		<div className="flex gap-1.5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Code editor' ) }</h2>
			<SelectControl
				value={ value }
				onChange={ ( newValue ) => onChange( newValue as SupportedEditor ) }
				__nextHasNoMarginBottom
				__next40pxDefaultSize
			>
				<optgroup label={ __( 'Installed' ) }>
					{ installedEditors.map( ( [ editor, label ] ) => (
						<option key={ editor } value={ editor }>
							{ label }
						</option>
					) ) }
				</optgroup>
				<optgroup label={ __( 'Not installed' ) }>
					{ uninstalledEditors.map( ( [ editor, label ] ) => (
						<option key={ editor } value={ editor } disabled>
							{ label }
						</option>
					) ) }
				</optgroup>
			</SelectControl>
		</div>
	);
};
