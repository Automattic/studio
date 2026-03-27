interface BannerProps {
	selected: boolean;
}

export function Banner( { selected }: BannerProps ) {
	return (
		<div
			style={ {
				position: 'fixed',
				top: 0,
				left: 0,
				right: 0,
				backgroundColor: selected ? '#1a7e3c' : '#3858e9',
				color: '#fff',
				fontSize: '14px',
				fontFamily: 'system-ui, -apple-system, sans-serif',
				padding: '10px 16px',
				zIndex: 2147483647,
				textAlign: 'center',
				boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
			} }
		>
			{ selected
				? 'Element selected \u2014 return to the CLI to use it in your prompt'
				: 'Click an element to select it \u2014 press Escape to cancel' }
		</div>
	);
}
