export default function FileIcon( {
	className,
	width = 16,
	height = 16,
}: {
	className?: string;
	width?: number;
	height?: number;
} ) {
	return (
		<svg
			width={ width }
			height={ height }
			className={ className }
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="4" y="2" width="12" height="16" rx="2" />
			<rect x="4" y="2" width="12" height="16" rx="2" stroke="#1E1E1E" strokeWidth="1.5" />
			<rect x="6.5" y="6" width="7" height="1.2" rx="0.6" fill="#1E1E1E" />
			<rect x="6.5" y="9" width="7" height="1.2" rx="0.6" fill="#1E1E1E" fillOpacity="0.7" />
			<rect x="6.5" y="12" width="5" height="1.2" rx="0.6" fill="#1E1E1E" fillOpacity="0.5" />
		</svg>
	);
}
