import { _n } from '@wordpress/i18n';
import { type Editor, type TLShape, useEditor, useValue } from 'tldraw';
import styles from './badges.module.css';
import { getStackId, getStackOrder, isStackExpanded } from './utils';

const STACK_BADGE_OFFSET = 96;

interface StackBadgeData {
	id: string;
	count: number;
	x: number;
	y: number;
	align: 'center';
}

export function StackBadges() {
	const editor = useEditor();

	const badges = useValue< StackBadgeData[] >(
		'desk-stack-badges',
		() => getStackBadges( editor ),
		[ editor ]
	);

	if ( badges.length === 0 ) {
		return null;
	}

	return (
		<>
			{ badges.map( ( badge ) => {
				return (
					<div
						key={ badge.id }
						className={ styles.badge }
						data-visible="true"
						data-align={ badge.align }
						style={ { translate: `${ badge.x }px ${ badge.y }px` } }
					>
						<span className={ styles.count }>{ badge.count }</span>
						<span className={ styles.label }>{ _n( 'item', 'items', badge.count ) }</span>
					</div>
				);
			} ) }
		</>
	);
}

function getStackBadges( editor: Editor ) {
	const badges: StackBadgeData[] = [];

	for ( const members of getStackGroups( editor ).values() ) {
		const firstMember = members[ 0 ];
		if ( ! firstMember ) {
			continue;
		}

		const stackId = getStackId( firstMember );
		if ( ! stackId ) {
			continue;
		}

		if ( ! isStackExpanded( firstMember ) ) {
			continue;
		}

		const badge = getExpandedStackBadge( editor, stackId, members );

		if ( badge ) {
			badges.push( badge );
		}
	}

	return badges;
}

function getStackGroups( editor: Editor ) {
	const stacks = new Map< string, TLShape[] >();

	for ( const shape of editor.getCurrentPageShapes() ) {
		const stackId = getStackId( shape );
		if ( ! stackId ) {
			continue;
		}

		const members = stacks.get( stackId ) ?? [];
		members.push( shape );
		stacks.set( stackId, members );
	}

	for ( const members of stacks.values() ) {
		members.sort( ( first, second ) => getStackOrder( first ) - getStackOrder( second ) );
	}

	return stacks;
}

function getExpandedStackBadge( editor: Editor, stackId: string, members: TLShape[] ) {
	const bounds = members.map( ( member ) => editor.getShapePageBounds( member.id ) );
	let pageMinX = Infinity;
	let pageMaxX = -Infinity;
	let pageMaxY = -Infinity;

	for ( const memberBounds of bounds ) {
		if ( ! memberBounds ) {
			continue;
		}

		pageMinX = Math.min( pageMinX, memberBounds.minX );
		pageMaxX = Math.max( pageMaxX, memberBounds.maxX );
		pageMaxY = Math.max( pageMaxY, memberBounds.maxY );
	}

	if ( ! Number.isFinite( pageMinX ) ) {
		return null;
	}

	const rowCount = members.length <= 5 ? 1 : 2;
	let pageY = pageMaxY + STACK_BADGE_OFFSET;

	if ( rowCount === 2 ) {
		const rowOneCount = Math.ceil( members.length / 2 );
		let rowOneMaxY = -Infinity;
		let rowTwoMinY = Infinity;

		for ( let index = 0; index < bounds.length; index++ ) {
			const memberBounds = bounds[ index ];
			if ( ! memberBounds ) {
				continue;
			}

			if ( index < rowOneCount ) {
				rowOneMaxY = Math.max( rowOneMaxY, memberBounds.maxY );
			} else {
				rowTwoMinY = Math.min( rowTwoMinY, memberBounds.minY );
			}
		}

		if ( Number.isFinite( rowOneMaxY ) && Number.isFinite( rowTwoMinY ) ) {
			pageY = ( rowOneMaxY + rowTwoMinY ) / 2;
		}
	}

	const screen = editor.pageToScreen( {
		x: ( pageMinX + pageMaxX ) / 2,
		y: pageY,
	} );

	return {
		id: stackId,
		count: members.length,
		x: screen.x,
		y: screen.y,
		align: 'center',
	} satisfies StackBadgeData;
}
