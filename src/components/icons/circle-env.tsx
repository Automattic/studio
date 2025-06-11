export const CircleEnvIcon = ( { color }: { color: string } ) => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
		<rect width="16" height="16" rx="8" fill="#4AB866" fillOpacity="0.4" />
		<rect
			x="1.25"
			y="1.25"
			width="13.5"
			height="13.5"
			rx="6.75"
			stroke="white"
			strokeOpacity="0.6"
			strokeWidth="2.5"
		/>
		<rect x="2" y="2" width="12" height="12" rx="6" fill={ color } />
	</svg>
);
