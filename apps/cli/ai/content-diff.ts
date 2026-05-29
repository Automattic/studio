type DiffOperation = 'equal' | 'delete' | 'insert';

interface DiffLine {
	type: DiffOperation;
	line: string;
}

function splitLines( content: string ): string[] {
	if ( content.length === 0 ) {
		return [];
	}
	return content.endsWith( '\n' ) ? content.slice( 0, -1 ).split( '\n' ) : content.split( '\n' );
}

function buildFullReplacementDiff( oldLines: string[], newLines: string[] ): DiffLine[] {
	return [
		...oldLines.map( ( line ) => ( { type: 'delete' as const, line } ) ),
		...newLines.map( ( line ) => ( { type: 'insert' as const, line } ) ),
	];
}

function buildDiffLines( oldLines: string[], newLines: string[] ): DiffLine[] {
	const cellCount = oldLines.length * newLines.length;
	if ( cellCount > 4_000_000 ) {
		return buildFullReplacementDiff( oldLines, newLines );
	}

	const table = Array.from( { length: oldLines.length + 1 }, () =>
		new Array< number >( newLines.length + 1 ).fill( 0 )
	);

	for ( let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex-- ) {
		for ( let newIndex = newLines.length - 1; newIndex >= 0; newIndex-- ) {
			table[ oldIndex ][ newIndex ] =
				oldLines[ oldIndex ] === newLines[ newIndex ]
					? table[ oldIndex + 1 ][ newIndex + 1 ] + 1
					: Math.max( table[ oldIndex + 1 ][ newIndex ], table[ oldIndex ][ newIndex + 1 ] );
		}
	}

	const diffLines: DiffLine[] = [];
	let oldIndex = 0;
	let newIndex = 0;

	while ( oldIndex < oldLines.length && newIndex < newLines.length ) {
		if ( oldLines[ oldIndex ] === newLines[ newIndex ] ) {
			diffLines.push( { type: 'equal', line: oldLines[ oldIndex ] } );
			oldIndex++;
			newIndex++;
		} else if ( table[ oldIndex + 1 ][ newIndex ] >= table[ oldIndex ][ newIndex + 1 ] ) {
			diffLines.push( { type: 'delete', line: oldLines[ oldIndex ] } );
			oldIndex++;
		} else {
			diffLines.push( { type: 'insert', line: newLines[ newIndex ] } );
			newIndex++;
		}
	}

	while ( oldIndex < oldLines.length ) {
		diffLines.push( { type: 'delete', line: oldLines[ oldIndex ] } );
		oldIndex++;
	}
	while ( newIndex < newLines.length ) {
		diffLines.push( { type: 'insert', line: newLines[ newIndex ] } );
		newIndex++;
	}

	return diffLines;
}

function countLinesByType( lines: DiffLine[], type: DiffOperation ): number {
	return lines.filter( ( line ) => line.type === type ).length;
}

export function createUnifiedDiff(
	oldContent: string,
	newContent: string,
	oldLabel = 'original',
	newLabel = 'fixed'
): string {
	if ( oldContent === newContent ) {
		return '';
	}

	const oldLines = splitLines( oldContent );
	const newLines = splitLines( newContent );
	const diffLines = buildDiffLines( oldLines, newLines );
	const oldCount = countLinesByType( diffLines, 'equal' ) + countLinesByType( diffLines, 'delete' );
	const newCount = countLinesByType( diffLines, 'equal' ) + countLinesByType( diffLines, 'insert' );

	return [
		`--- ${ oldLabel }`,
		`+++ ${ newLabel }`,
		`@@ -1,${ oldCount } +1,${ newCount } @@`,
		...diffLines.map( ( diffLine ) => {
			const prefix = diffLine.type === 'equal' ? ' ' : diffLine.type === 'delete' ? '-' : '+';
			return `${ prefix }${ diffLine.line }`;
		} ),
	].join( '\n' );
}
