import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { SupportedEditor, supportedEditorNames } from 'src/lib/editor';

interface EditorPickerProps {
	value: SupportedEditor;
	onChange: ( value: SupportedEditor ) => void;
}

export const EditorPicker = ( { value, onChange }: EditorPickerProps ) => {
	const { __ } = useI18n();

	return (
		<div className="flex gap-5 flex-col">
			<h2 className="a8c-subtitle-small">{ __( 'Editor' ) }</h2>
			<SelectControl
				value={ value || 'none' }
				onChange={ onChange }
				options={ Object.entries( supportedEditorNames ).map( ( [ editor, label ] ) => ( {
					value: editor as SupportedEditor,
					label,
				} ) ) }
				__nextHasNoMarginBottom
				className="mb-2"
			/>
		</div>
	);
};
