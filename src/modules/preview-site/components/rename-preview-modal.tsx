import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import TextControlComponent from 'src/components/text-control';

interface RenamePreviewModalProps {
	initialName: string;
	onRename: ( newName: string ) => void;
	onClose: () => void;
}

export function RenamePreviewModal( { initialName, onRename, onClose }: RenamePreviewModalProps ) {
	const [ newName, setNewName ] = useState( initialName );

	const handleRename = () => {
		if ( ! newName.trim() ) return;
		onRename( newName.trim() );
	};

	return (
		<Modal
			title={ __( 'Rename preview link' ) }
			size="medium"
			onRequestClose={ onClose }
			isDismissible
		>
			<form onSubmit={ handleRename }>
				<div className="flex flex-col gap-4">
					<label className="flex flex-col gap-1.5 leading-4 mb-6">
						<span className="font-semibold">{ __( 'Name' ) }</span>
						<TextControlComponent
							autoFocus
							onChange={ setNewName }
							value={ newName }
							maxLength={ 50 }
						></TextControlComponent>
					</label>
					<div className="flex justify-end gap-3 mt-4">
						<Button variant="tertiary" onClick={ onClose }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleRename }
							disabled={ ! newName.trim() || newName.trim() === initialName }
						>
							{ __( 'Save' ) }
						</Button>
					</div>
				</div>
			</form>
		</Modal>
	);
}
