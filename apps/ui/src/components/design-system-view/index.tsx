import {
	designDrift,
	designSheet,
	fontFamilyName,
	googleFontsUrl,
	parseDesignMd,
	type Style,
} from '@studio/design-md';
import { __, sprintf } from '@wordpress/i18n';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDesignAnnotations, type DesignAnnotationProps } from './annotations';
import { DriftPanel } from './drift-panel';
import styles from './style.module.css';
import type { SiteDesign } from '@/data/core';
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

function proseSections( design: string ): Array< { title: string; body: string } > {
	const body = design.trimStart().replace( /^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '' );
	return body
		.split( /^#\s+/m )
		.map( ( section ) => {
			const [ title = '', ...rest ] = section.split( '\n' );
			return { title: title.trim(), body: rest.join( '\n' ).trim() };
		} )
		.filter( ( section ) => section.title && section.body );
}

export function DesignSystemView( {
	siteId,
	siteDesign,
	annotations,
}: {
	siteId: string;
	siteDesign: SiteDesign | null;
	annotations?: DesignAnnotationProps;
} ) {
	const view = useMemo( () => {
		if ( ! siteDesign ) {
			return null;
		}
		try {
			const tokens = parseDesignMd( siteDesign.design );
			return {
				tokens,
				sheet: designSheet( tokens ),
				drift: designDrift( tokens, siteDesign.themeJson ),
				prose: proseSections( siteDesign.design ),
			};
		} catch ( error ) {
			return { error: error instanceof Error ? error.message : String( error ) };
		}
	}, [ siteDesign ] );
	const annotate = useDesignAnnotations( {
		...annotations,
		ready: !! view && ! ( 'error' in view ),
	} );

	if ( ! view ) {
		return (
			<div className={ styles.message }>
				<p>{ __( 'This site has no design system.' ) }</p>
				<p className={ styles.messageDetail }>
					{ __(
						'Studio Code saves one as DESIGN.md when it designs a site, next to the theme.json of its block theme.'
					) }
				</p>
			</div>
		);
	}

	if ( 'error' in view ) {
		return (
			<div className={ styles.message }>
				<p>{ __( 'DESIGN.md could not be read.' ) }</p>
				<p className={ styles.messageDetail }>{ view.error }</p>
			</div>
		);
	}

	const { tokens, sheet, drift, prose } = view;
	const fontsUrl = googleFontsUrl( sheet.styles.map( ( [ , style ] ) => style ) );
	const rounded = Object.entries( tokens.rounded ?? {} );
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

	const styleToken = ( style: Style ) =>
		`typography.${ sheet.styles.find( ( [ , candidate ] ) => candidate === style )?.[ 0 ] }`;
	const tile = ( [ name, value ]: [ string, string ] ) => {
		const color = sheet.colors.find( ( [ , candidate ] ) => candidate === value )?.[ 0 ] ?? name;
		return (
			<div
				key={ name }
				className={ styles.tile }
				data-background={ value === sheet.background || undefined }
				style={ { backgroundColor: value, color: sheet.ink( value ) } }
				{ ...annotate.target( `colors.${ color }`, name, value, `colors.${ color }` ) }
			>
				<span className={ styles.tileHex }>{ value }</span>
				<span className={ styles.tileName }>{ name }</span>
				{ annotate.marker( `colors.${ color }` ) }
			</div>
		);
	};
	const specimen = ( style: Style ) => (
		<figure
			className={ styles.specimen }
			{ ...annotate.target(
				styleToken( style ),
				titleCase( styleToken( style ).slice( 'typography.'.length ) ),
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
			{ annotate.popup }
			<header className={ styles.header }>
				<p className={ styles.eyebrow } style={ fontStyle( sheet.label ) }>
					{ __( 'Design system' ) }
				</p>
				{ tokens.name ? (
					<h1
						className={ styles.title }
						style={ fontStyle( sheet.display ) }
						{ ...annotate.target( 'name', __( 'Site name' ), String( tokens.name ), 'name' ) }
					>
						{ String( tokens.name ) }
						{ annotate.marker( 'name' ) }
					</h1>
				) : null }
				{ tokens.description ? (
					<p
						className={ styles.description }
						{ ...annotate.target(
							'description',
							__( 'Tagline' ),
							String( tokens.description ),
							'description'
						) }
					>
						{ String( tokens.description ) }
						{ annotate.marker( 'description' ) }
					</p>
				) : null }
				<DriftPanel siteId={ siteId } drift={ drift } />
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
									`typography.${ name }`,
									titleCase( name ),
									styleSpecs( style ),
									`typography.${ name }`
								) }
							>
								{ annotate.marker( `typography.${ name }` ) }
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
										'components.button-primary',
										__( 'Primary button' ),
										undefined,
										'components.button-primary'
									) }
								>
									{ __( 'Button' ) }
									{ annotate.marker( 'components.button-primary' ) }
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
										`spacing.${ name }`,
										sprintf(
											/* translators: %s: spacing step name, e.g. "md" */
											__( 'Spacing %s' ),
											name
										),
										dimension( value ),
										`spacing.${ name }`
									) }
								>
									{ annotate.marker( `spacing.${ name }` ) }
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
										key={ name }
										className={ styles.corner }
										{ ...annotate.target(
											`rounded.${ name }`,
											sprintf(
												/* translators: %s: corner radius name, e.g. "sm" */
												__( 'Corner %s' ),
												name
											),
											dimension( value ),
											`rounded.${ name }`
										) }
									>
										{ annotate.marker( `rounded.${ name }` ) }
										<div style={ { borderRadius: `min(${ dimension( value ) }, 32px)` } } />
										<figcaption>
											{ name } · { dimension( value ) }
										</figcaption>
									</figure>
								) ) }
							</div>
						) : null }
					</section>
				) : null }

				{ prose.length ? (
					<section className={ `${ styles.section } ${ styles.wide }` }>
						<h2 className={ styles.sectionTitle }>{ __( 'Guidelines' ) }</h2>
						<div className={ styles.guidelines }>
							{ prose.map( ( section ) => (
								<article
									key={ section.title }
									className={ styles.guideline }
									{ ...annotate.target(
										`guidelines.${ section.title }`,
										sprintf(
											/* translators: %s: DESIGN.md section title, e.g. "Voice" */
											__( 'Guideline: %s' ),
											section.title
										)
									) }
								>
									{ annotate.marker( `guidelines.${ section.title }` ) }
									<h3 style={ fontStyle( sheet.headline ) }>{ section.title }</h3>
									<ReactMarkdown remarkPlugins={ [ remarkGfm ] }>{ section.body }</ReactMarkdown>
								</article>
							) ) }
						</div>
					</section>
				) : null }
			</div>
		</div>
	);
}
