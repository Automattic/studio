export function ErrorIcon( props: { className?: string; size?: number } ) {
	const { className, size = 14 } = props;
	return (
		<svg
			className={ className || 'fill-current' }
			width={ size }
			height={ size }
			viewBox="0 0 14 14"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7 1.5625C3.99695 1.5625 1.5625 3.99695 1.5625 7C1.5625 10.003 3.99695 12.4375 7 12.4375C10.003 12.4375 12.4375 10.003 12.4375 7C12.4375 3.99695 10.003 1.5625 7 1.5625ZM0.4375 7C0.4375 3.37563 3.37563 0.4375 7 0.4375C10.6244 0.4375 13.5625 3.37563 13.5625 7C13.5625 10.6244 10.6244 13.5625 7 13.5625C3.37563 13.5625 0.4375 10.6244 0.4375 7Z"
			/>
			<path d="M7.75 3.25H6.25V7.75H7.75V3.25Z" />
			<path d="M7.75 9.25H6.25V10.75H7.75V9.25Z" />
		</svg>
	);
}
