import { __, sprintf } from '@wordpress/i18n';
import type { TransferSelection } from './use-transfer-selection';

export function publishSelectionSummary(
	selection: Pick< TransferSelection, 'scope' | 'nodes' | 'content' >
) {
	if ( selection.scope === 'all' ) return __( 'Everything' );
	if ( selection.scope === 'files' ) return __( 'Files only' );
	if ( selection.scope === 'content' ) return __( 'Database only' );
	const { nodes, content } = selection;
	if ( nodes.some( ( node ) => node.indeterminate ) ) return __( 'Custom selection' );
	const allFiles = nodes.length > 0 && nodes.every( ( node ) => node.checked );
	if ( allFiles ) return content ? __( 'Everything' ) : __( 'Files only' );
	const groups = [
		{ key: 'plugins', label: __( 'Plugins' ), lower: __( 'plugins' ) },
		{ key: 'themes', label: __( 'Themes' ), lower: __( 'themes' ) },
		{ key: 'uploads', label: __( 'Uploads' ), lower: __( 'uploads' ) },
	];
	const other = nodes.filter(
		( node ) =>
			! groups.some( ( group ) => node.path.replace( /\/$/, '' ) === `wp-content/${ group.key }` )
	);
	if ( other.some( ( node ) => node.checked ) && ! other.every( ( node ) => node.checked ) )
		return __( 'Custom selection' );
	const choices = [
		{ label: __( 'Database' ), lower: __( 'database' ), checked: content },
		...groups.map( ( group ) => ( {
			...group,
			checked: nodes.some(
				( node ) => node.path.replace( /\/$/, '' ) === `wp-content/${ group.key }` && node.checked
			),
		} ) ),
		...( other.length &&
		( other.some( ( node ) => node.checked ) ||
			( content &&
				nodes.filter( ( node ) => ! other.includes( node ) ).every( ( node ) => node.checked ) ) )
			? [
					{
						label: __( 'Other files' ),
						lower: __( 'other files' ),
						checked: other.every( ( node ) => node.checked ),
					},
			  ]
			: [] ),
	];
	if ( ! content && choices.slice( 1 ).every( ( choice ) => choice.checked ) )
		return __( 'Files only' );
	const selected = choices.filter( ( choice ) => choice.checked );
	if ( selected.length === 1 ) return content ? __( 'Database only' ) : selected[ 0 ].label;
	if ( selected.length === 2 )
		return sprintf( __( '%1$s and %2$s' ), selected[ 0 ].label, selected[ 1 ].lower );
	if ( selected.length === choices.length - 1 )
		return sprintf( __( 'All but %s' ), choices.find( ( choice ) => ! choice.checked )!.lower );
	if ( selected.length === 3 )
		return sprintf(
			__( '%1$s, %2$s, and %3$s' ),
			selected[ 0 ].label,
			selected[ 1 ].lower,
			selected[ 2 ].lower
		);
	return __( 'Custom selection' );
}
