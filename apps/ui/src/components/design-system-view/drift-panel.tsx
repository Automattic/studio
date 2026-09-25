import { __, _n, sprintf } from '@wordpress/i18n';
import { useFixSiteDesignDrift } from '@/data/queries/use-site-design';
import styles from './style.module.css';
import type { DesignDrift, DesignFix } from '@studio/design-md';

function driftLabel( drift: DesignDrift ): string {
	const kinds: Record< DesignDrift[ 'kind' ], string > = {
		color: __( 'Color' ),
		'font-family': __( 'Font family' ),
		'font-files': __( 'Font files' ),
		'font-size': __( 'Font size' ),
		spacing: __( 'Spacing' ),
	};
	return `${ kinds[ drift.kind ] } · ${ drift.slug }`;
}

function driftValues( drift: DesignDrift ): string {
	if ( drift.kind === 'font-files' ) {
		return sprintf(
			/* translators: %s: font family name */
			__( 'The theme declares %s without its font files.' ),
			drift.design
		);
	}
	return drift.theme === undefined
		? sprintf(
				/* translators: %s: value in DESIGN.md */
				__( 'DESIGN.md %s, missing from theme.json' ),
				drift.design
		  )
		: sprintf(
				/* translators: 1: value in DESIGN.md, 2: value in theme.json */
				__( 'DESIGN.md %1$s, theme.json %2$s' ),
				drift.design,
				drift.theme
		  );
}

export function DriftPanel( { siteId, drift }: { siteId: string; drift: DesignDrift[] } ) {
	const fixDrift = useFixSiteDesignDrift( siteId );
	const fix = ( entries: DesignDrift[], to: DesignFix[ 'to' ] ) =>
		fixDrift.mutate( entries.map( ( { kind, slug } ) => ( { kind, slug, to } ) ) );
	const action = ( label: string, onClick: () => void ) => (
		<button
			type="button"
			className={ styles.driftAction }
			disabled={ fixDrift.isPending }
			onClick={ onClick }
		>
			{ label }
		</button>
	);

	if ( ! drift.length ) {
		return <p className={ styles.sync }>{ __( 'theme.json matches DESIGN.md' ) }</p>;
	}
	return (
		<div className={ styles.sync } aria-busy={ fixDrift.isPending }>
			<details>
				<summary>
					{ sprintf(
						/* translators: %d: number of design tokens that differ between the theme and DESIGN.md */
						_n(
							'%d token in theme.json differs from DESIGN.md',
							'%d tokens in theme.json differ from DESIGN.md',
							drift.length
						),
						drift.length
					) }
				</summary>
				<dl className={ styles.driftList }>
					{ drift.map( ( entry ) => (
						<div key={ `${ entry.kind }:${ entry.slug }` }>
							<dt>{ driftLabel( entry ) }</dt>
							<dd>{ driftValues( entry ) }</dd>
							<dd className={ styles.driftActions }>
								{ action(
									entry.kind === 'font-files' ? __( 'Download fonts' ) : __( 'Use DESIGN.md' ),
									() => fix( [ entry ], 'theme' )
								) }
								{ entry.theme !== undefined
									? action( __( 'Keep theme.json' ), () => fix( [ entry ], 'design' ) )
									: null }
							</dd>
						</div>
					) ) }
				</dl>
			</details>
			{ action( __( 'Apply all from DESIGN.md' ), () => fix( drift, 'theme' ) ) }
			{ fixDrift.error ? (
				<p className={ styles.driftError } role="alert">
					{ fixDrift.error.message }
				</p>
			) : null }
		</div>
	);
}
