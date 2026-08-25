import { TILE_SIZE, getTile, isSolid, LEVEL_MAP } from './level';

export const INITIAL_LIVES = 3;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Player {
	x: number;
	y: number;
	w: number;
	h: number;
	vx: number;
	vy: number;
	onGround: boolean;
	facingRight: boolean;
	animFrame: number;
	animTimer: number;
	state: 'idle' | 'run' | 'jump' | 'dead';
	lives: number;
	invincibleTimer: number;
	idleTimer: number;
}

export interface Enemy {
	x: number;
	y: number;
	w: number;
	h: number;
	vx: number;
	vy: number;
	onGround: boolean;
	alive: boolean;
	animFrame: number;
	animTimer: number;
	type: 'block' | 'mguy';
	health: number;
	hurtTimer: number;
}

export interface Collectible {
	x: number;
	y: number;
	w: number;
	h: number;
	collected: boolean;
	animFrame: number;
	animTimer: number;
}

export interface Flag {
	x: number;
	y: number;
	w: number;
	h: number;
	animFrame: number;
	animTimer: number;
}

export function createPlayer( x: number, y: number ): Player {
	return {
		x,
		y,
		w: 28,
		h: 30,
		vx: 0,
		vy: 0,
		onGround: false,
		facingRight: true,
		animFrame: 0,
		animTimer: 0,
		state: 'idle',
		lives: INITIAL_LIVES,
		invincibleTimer: 0,
		idleTimer: 0,
	};
}

export function createEnemy( x: number, y: number ): Enemy {
	return {
		x,
		y,
		w: 20,
		h: 28,
		vx: -1.2,
		vy: 0,
		onGround: false,
		alive: true,
		animFrame: 0,
		animTimer: 0,
		type: 'block',
		health: 1,
		hurtTimer: 0,
	};
}

export function createMguy( x: number, y: number ): Enemy {
	return {
		x,
		y,
		w: 24,
		h: 38,
		vx: -1.8,
		vy: 0,
		onGround: false,
		alive: true,
		animFrame: 0,
		animTimer: 0,
		type: 'mguy',
		health: 2,
		hurtTimer: 0,
	};
}

export function createCollectible( x: number, y: number ): Collectible {
	return { x, y, w: 20, h: 20, collected: false, animFrame: 0, animTimer: 0 };
}

export function spawnEntities() {
	const enemies: Enemy[] = [];
	const collectibles: Collectible[] = [];
	let flag: Flag | null = null;

	for ( let row = 0; row < LEVEL_MAP.length; row++ ) {
		for ( let col = 0; col < LEVEL_MAP[ row ].length; col++ ) {
			const tile = LEVEL_MAP[ row ][ col ];
			const px = col * TILE_SIZE;
			const py = row * TILE_SIZE;
			if ( tile === 3 ) {
				collectibles.push( createCollectible( px + 6, py + 6 ) );
			} else if ( tile === 5 ) {
				enemies.push( createEnemy( px + 6, py ) );
			} else if ( tile === 7 ) {
				enemies.push( createMguy( px, py ) );
			} else if ( tile === 4 ) {
				flag = {
					x: px,
					y: py - TILE_SIZE,
					w: TILE_SIZE,
					h: TILE_SIZE * 2,
					animFrame: 0,
					animTimer: 0,
				};
			}
		}
	}

	return { enemies, collectibles, flag };
}

function resolveAxisX( rect: Rect, dx: number ): number {
	const newX = rect.x + dx;
	const left = Math.floor( newX / TILE_SIZE );
	const right = Math.floor( ( newX + rect.w - 1 ) / TILE_SIZE );
	const topRow = Math.floor( rect.y / TILE_SIZE );
	const botRow = Math.floor( ( rect.y + rect.h - 1 ) / TILE_SIZE );

	for ( let row = topRow; row <= botRow; row++ ) {
		if ( dx > 0 && isSolid( getTile( right, row ) ) ) {
			return right * TILE_SIZE - rect.w;
		}
		if ( dx < 0 && isSolid( getTile( left, row ) ) ) {
			return ( left + 1 ) * TILE_SIZE;
		}
	}
	return newX;
}

function resolveAxisY( rect: Rect, dy: number ): { y: number; onGround: boolean } {
	const newY = rect.y + dy;
	const topRow = Math.floor( newY / TILE_SIZE );
	const botRow = Math.floor( ( newY + rect.h - 1 ) / TILE_SIZE );
	const leftCol = Math.floor( rect.x / TILE_SIZE );
	const rightCol = Math.floor( ( rect.x + rect.w - 1 ) / TILE_SIZE );
	const onGround = false;

	for ( let col = leftCol; col <= rightCol; col++ ) {
		if ( dy > 0 && isSolid( getTile( col, botRow ) ) ) {
			return { y: botRow * TILE_SIZE - rect.h, onGround: true };
		}
		if ( dy < 0 && isSolid( getTile( col, topRow ) ) ) {
			return { y: ( topRow + 1 ) * TILE_SIZE, onGround };
		}
	}
	return { y: newY, onGround };
}

export function moveEntity( rect: Rect & { vx: number; vy: number; onGround?: boolean } ) {
	const newX = resolveAxisX( rect, rect.vx );
	if ( newX !== rect.x + rect.vx ) {
		rect.vx = 0;
	}
	rect.x = newX;

	const { y: newY, onGround } = resolveAxisY( rect, rect.vy );
	if ( onGround && rect.vy > 0 ) {
		rect.vy = 0;
	} else if ( newY !== rect.y + rect.vy ) {
		rect.vy = 0;
	}
	rect.y = newY;
	if ( 'onGround' in rect ) {
		( rect as { onGround: boolean } ).onGround = onGround;
	}
}

export function rectsOverlap( a: Rect, b: Rect ) {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
