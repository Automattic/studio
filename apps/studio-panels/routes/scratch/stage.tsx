
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { __experimentalText as Text } from '@wordpress/components';

export const stage = () => {
	const posts = useSelect( ( select ) => {
		return select( coreStore ).getEntityRecords( 'postType', 'post', {
			per_page: 100,
			orderby: 'date',
			order: 'desc',
			_embed: true,
			_fields: 'id,title,date,status,comment_count,_links,_embedded',
		} );
	}, [] );

	if ( ! posts ) {
		return <Text style={ { padding: '16px', display: 'block' } }>Loading...</Text>;
	}

	if ( posts.length === 0 ) {
		return <Text style={ { padding: '16px', display: 'block' } }>No posts found.</Text>;
	}

	const sorted = [ ...posts ].sort(
		( a, b ) => ( Number( b.comment_count ) || 0 ) - ( Number( a.comment_count ) || 0 )
	);

	return (
		<div style={ { padding: '16px' } }>
			<p style={ { fontSize: '11px', color: '#757575', marginBottom: '12px' } }>
				Ranked by comment count — best available signal without external analytics.
			</p>
			<table style={ { width: '100%', borderCollapse: 'collapse', fontSize: '13px' } }>
				<thead>
					<tr style={ { borderBottom: '2px solid #ddd', textAlign: 'left' } }>
						<th style={ { padding: '8px 12px', fontWeight: 600, width: '32px' } }>#</th>
						<th style={ { padding: '8px 12px', fontWeight: 600 } }>Title</th>
						<th style={ { padding: '8px 12px', fontWeight: 600 } }>Author</th>
						<th style={ { padding: '8px 12px', fontWeight: 600 } }>Date</th>
						<th style={ { padding: '8px 12px', fontWeight: 600, textAlign: 'center' } }>Comments</th>
						<th style={ { padding: '8px 12px', fontWeight: 600 } }>Status</th>
					</tr>
				</thead>
				<tbody>
					{ sorted.map( ( post, index ) => {
						const author = post._embedded?.author?.[ 0 ];
						const date = new Date( post.date ).toLocaleDateString( 'en-US', {
							year: 'numeric', month: 'short', day: 'numeric',
						} );
						const count = Number( post.comment_count ) || 0;
						return (
							<tr key={ post.id } style={ { borderBottom: '1px solid #f0f0f0' } }>
								<td style={ { padding: '8px 12px', color: '#bbb', fontWeight: 700 } }>{ index + 1 }</td>
								<td style={ { padding: '8px 12px' } }>{ post.title?.rendered || '(no title)' }</td>
								<td style={ { padding: '8px 12px', color: '#757575' } }>{ author?.name ?? '—' }</td>
								<td style={ { padding: '8px 12px', color: '#757575' } }>{ date }</td>
								<td style={ { padding: '8px 12px', textAlign: 'center', fontWeight: count > 0 ? 600 : 400, color: count > 0 ? '#1e1e1e' : '#bbb' } }>
									{ count }
								</td>
								<td style={ { padding: '8px 12px', color: '#757575' } }>{ post.status }</td>
							</tr>
						);
					} ) }
				</tbody>
			</table>
		</div>
	);
};
