import {
	Button,
	__experimentalInputControl as InputControl,
	TextareaControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import Modal from 'src/components/modal';

export default function EditRecordModal( {
	table,
	column,
	row,
	onClose,
	onSave,
	onChange,
}: {
	table: { name: string };
	column: { name: string; type: string };
	row: Record< string, string | number | null >;
	onClose: () => void;
	onSave: () => void;
	onChange: ( value: string | number ) => void;
} ) {
	const [ value, setValue ] = useState< string | number >( row?.[ column?.name ] ?? '' );
	const onChangeHandler = ( value: string | number ) => {
		setValue( value );
		onChange( value );
	};

	return (
		<Modal
			size="medium"
			title={ `Editing ${ column?.name } from ${ table?.name }` }
			isDismissible
			focusOnMount="firstContentElement"
			onRequestClose={ onClose }
			className="max-h-[90%]"
		>
			<div>
				{ column?.type === 'INTEGER' && (
					<InputControl
						className="mb-4"
						type="number"
						value={ value.toString() }
						onChange={ ( val ) => onChangeHandler( Number( val ) ) }
					/>
				) }
				{ column?.type === 'TEXT' && (
					<TextareaControl
						className="mb-4"
						value={ value.toString() }
						onChange={ onChangeHandler }
					/>
				) }
				<div className="flex justify-end gap-2">
					<Button variant="primary" onClick={ onSave }>
						{ __( 'Save' ) }
					</Button>
					<Button variant="secondary" onClick={ onClose }>
						{ __( 'Cancel' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}
