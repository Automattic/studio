import { __, sprintf } from '@wordpress/i18n';
import { useThemeDetails } from '../hooks/use-theme-details';

const backgroundSvg = (
	<svg
		aria-hidden="true"
		width="249"
		height="260"
		viewBox="0 0 249 260"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		xmlnsXlink="http://www.w3.org/1999/xlink"
	>
		<path
			d="M32 6.00001C32 2.6863 34.6863 0 38 0H243C246.314 0 249 2.68629 249 6V254C249 257.314 246.314 260 243 260H38C34.6863 260 32 257.314 32 254V6.00001Z"
			fill="#3858E9"
			fillOpacity="0.2"
		/>
		<path
			d="M0 27C0 22.5817 3.58172 19 8 19H249V241H8C3.58172 241 0 237.418 0 233V27Z"
			fill="#2C3338"
		/>
		<path
			d="M40 27.5C40 26.3954 40.8954 25.5 42 25.5H249V39.5H42C40.8954 39.5 40 38.6046 40 37.5V27.5Z"
			fill="#50575E"
		/>
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M11.8429 35.9203L8.65869 32.4177L11.8429 28.915L12.4903 29.5036L9.84122 32.4177L12.4903 35.3317L11.8429 35.9203Z"
			fill="#50575E"
		/>
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M24.1572 28.915L27.3414 32.4177L24.1572 35.9203L23.5098 35.3317L26.1589 32.4177L23.5098 29.5036L24.1572 28.915Z"
			fill="#50575E"
		/>
		<path
			d="M4 49C4 46.7909 5.79086 45 8 45H249V237H8C5.79086 237 4 235.209 4 233V49Z"
			fill="url(#pattern0)"
		/>
		<path
			d="M4 49C4 46.7909 5.79086 45 8 45H249V237H8C5.79086 237 4 235.209 4 233V49Z"
			fill="url(#pattern1)"
		/>
		<path
			opacity="0.05"
			d="M239 0H243C246.314 0 249 2.68629 249 6V254C249 257.314 246.314 260 243 260H239V0Z"
			fill="url(#paint0_linear_1865_95933)"
		/>
		<defs>
			<pattern id="pattern0" patternContentUnits="objectBoundingBox" width="1" height="1">
				<use
					xlinkHref="#image0_1865_95933"
					transform="matrix(0.00108995 0 0 0.00139082 -0.0220857 0)"
				/>
			</pattern>
			<pattern id="pattern1" patternContentUnits="objectBoundingBox" width="1" height="1">
				<use
					xlinkHref="#image1_1865_95933"
					transform="matrix(0.00108995 0 0 0.00139082 -0.0220857 0)"
				/>
			</pattern>
			<linearGradient
				id="paint0_linear_1865_95933"
				x1="239"
				y1="130.483"
				x2="249"
				y2="130.483"
				gradientUnits="userSpaceOnUse"
			>
				<stop stopOpacity="0" />
				<stop offset="1" />
			</linearGradient>
		</defs>
	</svg>
);
export function ScreenshotDemoSite( { site }: { site: SiteDetails } ) {
	const { selectedThumbnail: thumbnailData } = useThemeDetails();

	return (
		<div className="grid grid-cols-1 grid-rows-1 ml-auto">
			<div className="col-start-1 row-start-1">{ backgroundSvg }</div>
			<div className="w-[245px] max-h-[192px] overflow-hidden ml-1 mt-[45px] col-start-1 row-start-1">
				{ thumbnailData && (
					<img
						className="w-full"
						src={ thumbnailData }
						alt={ sprintf(
							/* translators: %s: The name of the website */
							__( 'Preview of the %s site' ),
							site.name
						) }
					/>
				) }
			</div>
		</div>
	);
}
