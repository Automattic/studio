// Spacefast's "SF" mark, as shipped with its own client integrations
// (github.com/spacefast/plugins, e.g. cursor/assets/logo.svg). Brand colors are
// intentional: the mark carries its own background, so it reads in both themes.
// The viewBox is cropped around the letters so they fill small circular avatars.
export function SpacefastLogo( { className }: { className?: string } ) {
	return (
		<svg className={ className } viewBox="22 21 116 116" aria-hidden="true" focusable="false">
			<rect width="160" height="160" fill="#0c0c0c" />
			<g transform="rotate(-1 80 80)">
				<g transform="translate(39.75 55.5) scale(1.5)" fill="#d8f24b">
					<path d="M0 0h24v7H7v7h17v20H0v-7h17v-7H0V0Z" />
					<path d="M0 0h25v7H7v6h15v7H7v14H0V0Z" transform="translate(31 0)" />
				</g>
				<g transform="translate(34.75 50.5) scale(1.5)" fill="#fcfcfa">
					<path d="M0 0h24v7H7v7h17v20H0v-7h17v-7H0V0Z" />
					<path d="M0 0h25v7H7v6h15v7H7v14H0V0Z" transform="translate(31 0)" />
				</g>
			</g>
		</svg>
	);
}
