export default (
	<svg xmlns="http://www.w3.org/2000/svg" width="32" height="33" fill="none">
		<rect width="32" height="32" y=".5" fill="#C3C4C7" rx="16" />
		<mask
			id="a"
			width="16"
			height="17"
			x="8"
			y="8"
			maskUnits="userSpaceOnUse"
			style={ { maskType: 'luminance' } }
		>
			<path
				fill="#fff"
				fillRule="evenodd"
				d="M20 12.5a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-4 5c4.1 0 8 2.6 8 5 0 2-8 2-8 2s-8 0-8-2c0-2.4 3.9-5 8-5Z"
				clipRule="evenodd"
			/>
		</mask>
		<g mask="url(#a)">
			<path fill="#fff" d="M4 4.5h24v24H4z" />
		</g>
	</svg>
);
