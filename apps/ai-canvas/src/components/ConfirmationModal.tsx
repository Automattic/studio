import { getFriendlyDescription } from '../lib/friendly-names';
import type { PickedElement } from '../lib/types';

interface ConfirmationModalProps {
	element: PickedElement;
	onGrabAnother: () => void;
}

const btnStyle: React.CSSProperties = {
	padding: '8px 18px',
	borderRadius: 6,
	border: 'none',
	fontSize: 13,
	fontWeight: 500,
	cursor: 'pointer',
	fontFamily: 'system-ui, -apple-system, sans-serif',
};

export function ConfirmationModal( { element, onGrabAnother }: ConfirmationModalProps ) {
	const summary = getFriendlyDescription( element.tagName, element.wpBlockType, element.innerText );

	return (
		<div
			style={ {
				position: 'fixed',
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				backgroundColor: 'rgba(0, 0, 0, 0.4)',
				zIndex: 2147483647,
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
			} }
		>
			<div
				style={ {
					backgroundColor: '#fff',
					borderRadius: 12,
					boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
					padding: '20px 24px',
					fontFamily: 'system-ui, -apple-system, sans-serif',
					fontSize: 14,
					color: '#1e1e1e',
					minWidth: 340,
					maxWidth: 500,
				} }
			>
				<div style={ { marginBottom: 8, fontWeight: 600, fontSize: 15, lineHeight: 1.4 } }>
					Element selected
				</div>
				<div
					style={ {
						marginBottom: 12,
						padding: '10px 12px',
						backgroundColor: '#f5f5f5',
						borderRadius: 6,
						fontSize: 13,
						color: '#444',
						lineHeight: 1.4,
					} }
				>
					{ summary }
				</div>
				<div style={ { marginBottom: 16, fontSize: 12, color: '#888', lineHeight: 1.4 } }>
					Return to the CLI to use this selection in your next prompt.
				</div>
				<div style={ { display: 'flex', gap: 10, justifyContent: 'flex-end' } }>
					<button
						type="button"
						style={ { ...btnStyle, backgroundColor: '#e0e0e0', color: '#333' } }
						onClick={ onGrabAnother }
					>
						Grab another element
					</button>
				</div>
			</div>
		</div>
	);
}
