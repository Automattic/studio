import {
	designSheet,
	fontFamilyName,
	googleFontsUrl,
	presetList,
	themeJsonDesign,
	type Style,
} from '@studio/common/sites/design-sheet';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo } from 'react';
import { useDesignAnnotations, type DesignAnnotationProps } from './annotations';
import styles from './style.module.css';
import type { GlobalStyles } from '@/data/core';
import type { CSSProperties } from 'react';

const dimension = ( value: unknown ) =>
	typeof value === 'number' ? `${ value }px` : value === undefined ? undefined : String( value );

const titleCase = ( key: string ) =>
	key.replace( /[-_]+/g, ' ' ).replace( /\b\w/g, ( char ) => char.toUpperCase() );

function fontStyle( style: Style ): CSSProperties {
	const family = fontFamilyName( style.fontFamily );
	return {
		fontFamily: family ? `"${ family }", sans-serif` : undefined,
		fontWeight: style.fontWeight as CSSProperties[ 'fontWeight' ],
		letterSpacing: dimension( style.letterSpacing ),
		textTransform: style.textTransform as CSSProperties[ 'textTransform' ],
	};
}

function styleSpecs( style: Style ): string {
	return [
		fontFamilyName( style.fontFamily ),
		style.fontWeight,
		dimension( style.fontSize ),
		style.lineHeight !== undefined && `/ ${ style.lineHeight }`,
		style.letterSpacing !== undefined && dimension( style.letterSpacing ),
	]
		.filter( ( part ) => part !== undefined && part !== false && part !== '' )
		.join( ' · ' );
}

// Where WordPress keeps each role the sheet shows, named as theme.json names it:
// a preset by its reference, a style by its path in `styles`.
const STYLE_PATHS: Record< string, string > = {
	display: 'styles.elements.h1',
	headline: 'styles.elements.h2',
	body: 'styles.typography',
	label: 'styles.elements.button.typography',
};

export function DesignSystemView( {
	siteId,
	globalStyles,
	onAnnotationPick,
	onAnnotationAnchor,
}: {
	siteId: string;
	globalStyles: GlobalStyles;
} & DesignAnnotationProps ) {
	const view = useMemo( () => {
		if ( ! globalStyles ) {
			return null;
		}
		try {
			const tokens = themeJsonDesign( globalStyles );
			const palette = presetList(
				( globalStyles.settings.color as { palette?: unknown } | undefined )?.palette
			);
			return { tokens, sheet: designSheet( tokens ), palette };
		} catch ( error ) {
			return { error: error instanceof Error ? error.message : String( error ) };
		}
	}, [ globalStyles ] );
	const annotate = useDesignAnnotations( { siteId, onAnnotationPick, onAnnotationAnchor } );

	if ( ! view ) {
		return (
			<div className={ styles.message }>
				<p>{ __( 'This site has no design system.' ) }</p>
				<p className={ styles.messageDetail }>
					{ __( 'The design system shows the Styles of a block theme.' ) }
				</p>
			</div>
		);
	}

	if ( 'error' in view ) {
		return (
			<div className={ styles.message }>
				<p>{ __( "The site's Styles could not be shown." ) }</p>
				<p className={ styles.messageDetail }>{ view.error }</p>
			</div>
		);
	}

	const { tokens, sheet, palette } = view;
	const fontsUrl = googleFontsUrl( sheet.styles.map( ( [ , style ] ) => style ) );
	// theme.json sets one corner radius the sheet shows: the button's.
	const rounded = tokens.rounded?.sm === undefined ? [] : [ [ 'button', tokens.rounded.sm ] ];
	const spacing = Object.entries( tokens.spacing ?? {} );
	const small = dimension( tokens.rounded?.sm ?? tokens.rounded?.md ?? 0 );
	const accents = sheet.palette.slice( 3 );
	const showReading =
		fontFamilyName( sheet.display.fontFamily ) !== fontFamilyName( sheet.body.fontFamily ) ||
		sheet.display.fontWeight !== sheet.body.fontWeight;
	const rootStyle = {
		'--ds-background': sheet.background,
		'--ds-text': sheet.text,
		'--ds-primary': sheet.primary,
		'--ds-accent': sheet.accent,
		'--ds-accent-ink': sheet.ink( sheet.accent ),
		'--ds-small': small,
		'--ds-card-radius': `min(${ dimension(
			tokens.rounded?.md ?? tokens.rounded?.sm ?? 0
		) }, 24px)`,
		'--ds-tag-radius': dimension( tokens.rounded?.pill ) ?? small,
		...fontStyle( sheet.body ),
	} as CSSProperties;

	const styleName = ( style: Style ) =>
		sheet.styles.find( ( [ , candidate ] ) => candidate === style )?.[ 0 ] ?? 'body';
	const styleToken = ( style: Style ) => STYLE_PATHS[ styleName( style ) ];
	const tile = ( [ name, value ]: [ string, string ] ) => {
		const slug = palette.find( ( preset ) => preset.color === value )?.slug;
		const token = slug ? `var:preset|color|${ slug }` : `styles.color.${ name }`;
		return (
			<div
				key={ name }
				className={ styles.tile }
				data-background={ value === sheet.background || undefined }
				style={ { backgroundColor: value, color: sheet.ink( value ) } }
				{ ...annotate.target( token, slug ?? name, value, token ) }
			>
				<span className={ styles.tileHex }>{ value }</span>
				<span className={ styles.tileName }>{ slug ?? name }</span>
				{ annotate.marker( token ) }
			</div>
		);
	};
	const specimen = ( style: Style ) => (
		<figure
			className={ styles.specimen }
			{ ...annotate.target(
				styleToken( style ),
				titleCase( styleName( style ) ),
				styleSpecs( style ),
				styleToken( style )
			) }
		>
			{ annotate.marker( styleToken( style ) ) }
			<div className={ styles.aa } style={ fontStyle( style ) }>
				Aa
			</div>
			<figcaption>
				{ [ fontFamilyName( style.fontFamily ), style.fontWeight ].filter( Boolean ).join( ' · ' ) }
			</figcaption>
		</figure>
	);

	return (
		<div
			className={ annotate.isPicking ? `${ styles.root } ${ styles.picking }` : styles.root }
			style={ rootStyle }
			onClickCapture={ annotate.onClickCapture }
		>
			{ fontsUrl ? <link rel="stylesheet" href={ fontsUrl } precedence="default" /> : null }
			<header className={ styles.header }>
				<p className={ styles.eyebrow } style={ fontStyle( sheet.label ) }>
					{ __( 'Design system' ) }
				</p>
			</header>

			<div className={ styles.sections }>
				<section className={ styles.section }>
					<h2 className={ styles.sectionTitle }>{ __( 'Type' ) }</h2>
					<div className={ styles.specimens }>
						{ specimen( sheet.display ) }
						{ showReading ? specimen( sheet.body ) : null }
					</div>
				</section>

				<section className={ styles.section }>
					<h2 className={ styles.sectionTitle }>{ __( 'Color' ) }</h2>
					<div className={ styles.palette }>
						<div className={ styles.lead }>
							{ tile( sheet.palette[ 0 ] ) }
							<div className={ styles.pair }>{ sheet.palette.slice( 1, 3 ).map( tile ) }</div>
						</div>
						{ accents.length ? (
							<div className={ styles.accents }>{ accents.map( tile ) }</div>
						) : null }
					</div>
				</section>

				<section className={ `${ styles.section } ${ styles.wide }` }>
					<h2 className={ styles.sectionTitle }>{ __( 'Type scale' ) }</h2>
					<div className={ styles.scale }>
						{ sheet.styles.map( ( [ name, style ] ) => (
							<div
								key={ name }
								className={ styles.scaleRow }
								{ ...annotate.target(
									STYLE_PATHS[ name ],
									titleCase( name ),
									styleSpecs( style ),
									STYLE_PATHS[ name ]
								) }
							>
								{ annotate.marker( STYLE_PATHS[ name ] ) }
								<div className={ styles.scaleMeta }>
									<span className={ styles.scaleName }>{ titleCase( name ) }</span>
									<span className={ styles.scaleSpecs }>{ styleSpecs( style ) }</span>
								</div>
								<p
									className={ styles.scaleSample }
									style={ {
										...fontStyle( style ),
										fontSize: `min(${ dimension( style.fontSize ) ?? '1rem' }, 72px)`,
										lineHeight: style.lineHeight as CSSProperties[ 'lineHeight' ],
									} }
								>
									{ sprintf(
										/* translators: 1: text style name, e.g. "Headline", 2: font family name */
										__( '%1$s in %2$s' ),
										titleCase( name ),
										fontFamilyName( style.fontFamily ) || __( 'the default font' )
									) }
								</p>
							</div>
						) ) }
					</div>
				</section>

				<section className={ styles.section }>
					<h2 className={ styles.sectionTitle }>{ __( 'Components' ) }</h2>
					<div className={ styles.kit }>
						<div className={ styles.stack }>
							<div className={ styles.row }>
								<span
									className={ styles.button }
									data-outline={ sheet.button.backgroundColor === 'transparent' || undefined }
									style={ {
										...fontStyle( sheet.button.typography ),
										backgroundColor: sheet.button.backgroundColor,
										color: sheet.button.textColor,
										borderRadius: dimension( sheet.button.rounded ),
										padding: dimension( sheet.button.padding ),
									} }
									{ ...annotate.target(
										'styles.elements.button',
										__( 'Primary button' ),
										undefined,
										'styles.elements.button'
									) }
								>
									{ __( 'Button' ) }
									{ annotate.marker( 'styles.elements.button' ) }
								</span>
								<span
									className={ styles.button }
									data-outline
									style={ {
										...fontStyle( sheet.button.typography ),
										borderRadius: dimension( sheet.button.rounded ),
										padding: dimension( sheet.button.padding ),
									} }
									{ ...annotate.target( 'button-secondary', __( 'Secondary button' ) ) }
								>
									{ __( 'Button' ) }
									{ annotate.marker( 'button-secondary' ) }
								</span>
								<span className={ styles.link } { ...annotate.target( 'link', __( 'Link' ) ) }>
									{ __( 'Link' ) }
									{ annotate.marker( 'link' ) }
								</span>
							</div>
							<div className={ styles.row }>
								<span className={ styles.input } { ...annotate.target( 'input', __( 'Input' ) ) }>
									{ __( 'Input' ) }
									{ annotate.marker( 'input' ) }
								</span>
							</div>
							<div className={ styles.row }>
								<span
									className={ styles.tag }
									style={ fontStyle( sheet.label ) }
									{ ...annotate.target( 'tag', __( 'Tag' ) ) }
								>
									{ __( 'Tag' ) }
									{ annotate.marker( 'tag' ) }
								</span>
								<span
									className={ `${ styles.tag } ${ styles.tagAccent }` }
									style={ fontStyle( sheet.label ) }
									{ ...annotate.target( 'tag-accent', __( 'Accent tag' ) ) }
								>
									{ __( 'Tag' ) }
									{ annotate.marker( 'tag-accent' ) }
								</span>
							</div>
						</div>
						<div className={ styles.card } { ...annotate.target( 'card', __( 'Card' ) ) }>
							{ annotate.marker( 'card' ) }
							<span className={ styles.tag } style={ fontStyle( sheet.label ) }>
								{ __( 'Card' ) }
							</span>
							<strong style={ fontStyle( sheet.headline ) }>{ __( 'Card title' ) }</strong>
							<u style={ { width: '90%' } } />
							<u style={ { width: '65%' } } />
						</div>
					</div>
				</section>

				{ spacing.length || rounded.length ? (
					<section className={ styles.section }>
						<h2 className={ styles.sectionTitle }>{ __( 'Spacing & corners' ) }</h2>
						<div className={ styles.spacing }>
							{ spacing.map( ( [ name, value ] ) => (
								<div
									key={ name }
									className={ styles.spacingRow }
									{ ...annotate.target(
										`var:preset|spacing|${ name }`,
										sprintf(
											/* translators: %s: spacing step name, e.g. "md" */
											__( 'Spacing %s' ),
											name
										),
										dimension( value ),
										`var:preset|spacing|${ name }`
									) }
								>
									{ annotate.marker( `var:preset|spacing|${ name }` ) }
									<span className={ styles.spacingName }>{ name }</span>
									<span
										className={ styles.spacingBar }
										style={ { width: `min(${ dimension( value ) }, 100%)` } }
									/>
									<span className={ styles.spacingValue }>{ dimension( value ) }</span>
								</div>
							) ) }
						</div>
						{ rounded.length ? (
							<div className={ styles.corners }>
								{ rounded.map( ( [ name, value ] ) => (
									<figure
										key={ String( name ) }
										className={ styles.corner }
										{ ...annotate.target(
											'styles.elements.button.border.radius',
											__( 'Button corners' ),
											dimension( value ),
											'styles.elements.button.border.radius'
										) }
									>
										{ annotate.marker( 'styles.elements.button.border.radius' ) }
										<div style={ { borderRadius: `min(${ dimension( value ) }, 32px)` } } />
										<figcaption>{ dimension( value ) }</figcaption>
									</figure>
								) ) }
							</div>
						) : null }
					</section>
				) : null }
			</div>
		</div>
	);
}
