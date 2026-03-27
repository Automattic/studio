interface TooltipProps {
	label: string;
	top: number;
	left: number;
}

export function Tooltip( { label, top, left }: TooltipProps ) {
	return (
		<div
			style={ {
				position: 'fixed',
				pointerEvents: 'none',
				top,
				left,
				backgroundColor: '#1e1e1e',
				color: '#fff',
				fontSize: 12,
				fontFamily: 'system-ui, -apple-system, sans-serif',
				padding: '3px 8px',
				borderRadius: 4,
				zIndex: 2147483647,
				whiteSpace: 'nowrap',
			} }
		>
			{ label }
		</div>
	);
}
