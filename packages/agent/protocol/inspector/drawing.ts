type Point = { x: number; y: number };

// Keep the factory self-contained: its source is injected into the preview page.
export function createDrawingGeometry() {
	const midpoint = ( a: Point, b: Point ) => ( { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 } );
	const position = ( p: Point ) =>
		`${ Math.round( p.x * 100 ) / 100 } ${ Math.round( p.y * 100 ) / 100 }`;
	function pathData( points: Point[] ) {
		if ( ! points.length ) return '';
		if ( points.length === 1 ) return `M${ position( points[ 0 ] ) }l0.01 0`;
		if ( points.length === 2 ) return `M${ position( points[ 0 ] ) }L${ position( points[ 1 ] ) }`;
		const first = points[ 0 ];
		const last = points[ points.length - 1 ];
		const closed = first.x === last.x && first.y === last.y;
		const count = points.length - ( closed ? 1 : 0 );
		let path = `M${ position( closed ? midpoint( points[ count - 1 ], first ) : first ) }`;
		for ( let i = closed ? 0 : 1; i < count; i++ ) {
			const next =
				closed || i < count - 1 ? midpoint( points[ i ], points[ ( i + 1 ) % count ] ) : last;
			path += `Q${ position( points[ i ] ) } ${ position( next ) }`;
		}
		return path + ( closed ? 'Z' : '' );
	}
	function resample( points: Point[], count: number ) {
		const distances = [ 0 ];
		for ( let i = 1; i < points.length; i++ ) {
			distances.push(
				distances[ i - 1 ] +
					Math.hypot( points[ i ].x - points[ i - 1 ].x, points[ i ].y - points[ i - 1 ].y )
			);
		}
		const length = distances[ distances.length - 1 ];
		if ( ! length ) return [];
		let segment = 1;
		return Array.from( { length: count }, ( _, index ) => {
			const distance = ( length * index ) / ( count - 1 );
			while ( segment < distances.length - 1 && distances[ segment ] < distance ) segment++;
			const a = points[ segment - 1 ];
			const b = points[ segment ];
			const fraction =
				( distance - distances[ segment - 1 ] ) /
				( distances[ segment ] - distances[ segment - 1 ] || 1 );
			return { x: a.x + ( b.x - a.x ) * fraction, y: a.y + ( b.y - a.y ) * fraction };
		} );
	}
	function recognizeEllipse( points: Point[] ): Point[] | null {
		if ( points.length < 12 ) return null;
		const samples = resample( points, 65 );
		if ( ! samples.length ) return null;
		const center = samples
			.slice( 0, -1 )
			.reduce( ( sum, p ) => ( { x: sum.x + p.x / 64, y: sum.y + p.y / 64 } ), { x: 0, y: 0 } );
		let xx = 0,
			yy = 0,
			xy = 0;
		for ( const p of samples ) {
			const x = p.x - center.x,
				y = p.y - center.y;
			xx += x * x;
			yy += y * y;
			xy += x * y;
		}
		const rotation = Math.atan2( 2 * xy, xx - yy ) / 2;
		const cos = Math.cos( rotation ),
			sin = Math.sin( rotation );
		const local = samples.map( ( p ) => ( {
			x: ( p.x - center.x ) * cos + ( p.y - center.y ) * sin,
			y: -( p.x - center.x ) * sin + ( p.y - center.y ) * cos,
		} ) );
		const left = Math.min( ...local.map( ( p ) => p.x ) ),
			right = Math.max( ...local.map( ( p ) => p.x ) );
		const top = Math.min( ...local.map( ( p ) => p.y ) ),
			bottom = Math.max( ...local.map( ( p ) => p.y ) );
		let rx = ( right - left ) / 2,
			ry = ( bottom - top ) / 2;
		if ( Math.min( rx, ry ) < 10 || Math.max( rx, ry ) / Math.min( rx, ry ) > 8 ) return null;
		const first = points[ 0 ],
			last = points[ points.length - 1 ];
		if ( Math.hypot( first.x - last.x, first.y - last.y ) > Math.min( rx, ry ) * 0.75 ) return null;
		const cx = ( left + right ) / 2,
			cy = ( top + bottom ) / 2;
		let error = 0,
			turn = 0,
			travel = 0;
		let previousAngle: number | undefined;
		for ( const p of local ) {
			const x = ( p.x - cx ) / rx,
				y = ( p.y - cy ) / ry;
			const deviation = Math.abs( Math.hypot( x, y ) - 1 );
			if ( deviation > 0.27 ) return null;
			error += ( deviation * deviation ) / local.length;
			const angle = Math.atan2( y, x );
			if ( previousAngle !== undefined ) {
				const delta = Math.atan2(
					Math.sin( angle - previousAngle ),
					Math.cos( angle - previousAngle )
				);
				turn += delta;
				travel += Math.abs( delta );
			}
			previousAngle = angle;
		}
		if (
			error > 0.0121 ||
			Math.abs( turn ) < 5.4 ||
			Math.abs( turn ) > 7.1 ||
			travel > Math.abs( turn ) * 1.15
		)
			return null;
		if ( Math.max( rx, ry ) / Math.min( rx, ry ) < 1.12 ) rx = ry = ( rx + ry ) / 2;
		const phase = Math.atan2( ( local[ 0 ].y - cy ) / ry, ( local[ 0 ].x - cx ) / rx );
		const result = Array.from( { length: 64 }, ( _, index ) => {
			const angle = phase + Math.sign( turn ) * ( index / 64 ) * Math.PI * 2;
			const x = cx + Math.cos( angle ) * rx,
				y = cy + Math.sin( angle ) * ry;
			return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
		} );
		result.push( { ...result[ 0 ] } );
		return result;
	}
	return { pathData, recognizeEllipse };
}
