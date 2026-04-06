import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { taskUpdatedFromMain } from 'src/stores/tasks-slice';

interface EditableTaskTitleProps {
	taskId: string;
	title: string;
	className?: string;
	editing?: boolean;
	onEditingChange?: ( editing: boolean ) => void;
}

export function EditableTaskTitle( {
	taskId,
	title,
	className,
	editing,
	onEditingChange,
}: EditableTaskTitleProps ) {
	const [ internalEditing, setInternalEditing ] = useState( false );
	const isEditing = editing ?? internalEditing;
	const onEditingChangeRef = useRef( onEditingChange );
	useEffect( () => {
		onEditingChangeRef.current = onEditingChange;
	}, [ onEditingChange ] );

	const setIsEditing = useCallback( ( value: boolean ) => {
		setInternalEditing( value );
		onEditingChangeRef.current?.( value );
	}, [] );

	const [ editValue, setEditValue ] = useState( title );
	const inputRef = useRef< HTMLInputElement >( null );
	const dispatch = useAppDispatch();

	useEffect( () => {
		if ( ! isEditing ) {
			setEditValue( title );
		}
	}, [ title, isEditing ] );

	useEffect( () => {
		if ( isEditing ) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [ isEditing ] );

	const commit = useCallback( () => {
		setIsEditing( false );
		const trimmed = editValue.trim();
		if ( ! trimmed || trimmed === title ) {
			setEditValue( title );
			return;
		}
		// Optimistic update
		dispatch(
			taskUpdatedFromMain( {
				id: taskId,
				title: trimmed,
				updatedAt: Date.now(),
			} as Parameters< typeof taskUpdatedFromMain >[ 0 ] )
		);
		void getIpcApi().updateTask( taskId, { title: trimmed } );
	}, [ editValue, title, taskId, dispatch, setIsEditing ] );

	const handleKeyDown = ( e: React.KeyboardEvent ) => {
		if ( e.key === 'Enter' ) {
			e.preventDefault();
			commit();
		} else if ( e.key === 'Escape' ) {
			setEditValue( title );
			setIsEditing( false );
		}
	};

	if ( isEditing ) {
		return (
			<input
				ref={ inputRef }
				value={ editValue }
				onChange={ ( e ) => setEditValue( e.target.value ) }
				onBlur={ commit }
				onKeyDown={ handleKeyDown }
				className={ cx(
					'bg-transparent border-none outline-none p-0 m-0',
					'ring-1 ring-frame-theme/50 rounded px-1 -mx-1',
					className
				) }
				style={ { font: 'inherit', lineHeight: 'inherit' } }
			/>
		);
	}

	return (
		<span
			className={ cx( 'truncate cursor-default', className ) }
			onDoubleClick={ () => setIsEditing( true ) }
		>
			{ title }
		</span>
	);
}
