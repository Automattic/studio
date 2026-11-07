import { __ } from '@wordpress/i18n';
import { XIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { SendIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './text-edit-controls.module.css';
import type { AnnotationAnchor } from '@/features/annotations';

export function TextEditControls( {
	anchor,
	changed,
	onCancel,
	onSend,
}: {
	anchor: AnnotationAnchor;
	changed: boolean;
	onCancel: () => void;
	onSend: () => void;
} ) {
	const ref = useRef< HTMLDivElement >( null );
	const [ position, setPosition ] = useState( { left: 0, top: 0 } );
	useLayoutEffect( () => {
		const controls = ref.current;
		const container = controls?.parentElement;
		if ( ! controls || ! container ) return;
		setPosition( {
			left: Math.max(
				8,
				Math.min( anchor.left + 8, container.clientWidth - controls.offsetWidth - 8 )
			),
			top: Math.max(
				8,
				Math.min(
					anchor.top - controls.offsetHeight / 2,
					container.clientHeight - controls.offsetHeight - 8
				)
			),
		} );
	}, [ anchor ] );
	return (
		<div className={ styles.overlay }>
			<div
				ref={ ref }
				role="group"
				aria-label={ __( 'Text annotation' ) }
				className={ styles.controls }
				style={ position }
				data-studio-inspector
			>
				<IconButton
					size="icon"
					shape="round"
					variant="outline"
					className={ styles.cancel }
					icon={ <XIcon /> }
					label={ __( 'Cancel text change' ) }
					onClick={ onCancel }
				/>
				<IconButton
					size="icon"
					shape="round"
					variant="accent"
					className={ styles.send }
					icon={ <SendIcon /> }
					label={ __( 'Send text change' ) }
					disabled={ ! changed }
					focusableWhenDisabled={ false }
					onClick={ onSend }
				/>
			</div>
		</div>
	);
}
