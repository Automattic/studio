import { Player, Enemy, Collectible, Flag } from './entities';
import { TILE_SIZE, LEVEL_MAP, getTile } from './level';

const COLORS = {
	sky: '#1a8cff',
	skyBottom: '#87ceeb',
	ground: '#5d3a1a',
	groundTop: '#4a7c2f',
	platform: '#8b6914',
	platformTop: '#c8a43c',
	hill: '#2d6e1f',
	wapuuBody: '#e8e0d0',
	wapuuHat: '#21759b',
	wapuuEar: '#e8d0b0',
	wapuuEye: '#2c1810',
	wapuuBelly: '#f0e8d8',
	wapuuPaw: '#e8c890',
	enemyBody: '#cc3333',
	enemyEye: '#fff',
	collectible: '#f5a623',
	collectibleShine: '#fff8e0',
	flagPole: '#888',
	flagBanner: '#21759b',
	hud: 'rgba(0,0,0,0.5)',
	hudText: '#fff',
};

function drawBackground( ctx: CanvasRenderingContext2D, cameraX: number, w: number, h: number ) {
	const grad = ctx.createLinearGradient( 0, 0, 0, h );
	grad.addColorStop( 0, COLORS.sky );
	grad.addColorStop( 1, COLORS.skyBottom );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, w, h );

	// Parallax hills
	ctx.fillStyle = COLORS.hill;
	const hillOffset = ( cameraX * 0.3 ) % 200;
	for ( let i = -1; i < Math.ceil( w / 200 ) + 1; i++ ) {
		const hx = i * 200 - hillOffset;
		ctx.beginPath();
		ctx.arc( hx + 100, h - 60, 80, Math.PI, 0 );
		ctx.fill();
		ctx.beginPath();
		ctx.arc( hx + 180, h - 40, 60, Math.PI, 0 );
		ctx.fill();
	}
}

function drawTiles( ctx: CanvasRenderingContext2D, cameraX: number, w: number, _h: number ) {
	const startCol = Math.max( 0, Math.floor( cameraX / TILE_SIZE ) - 1 );
	const endCol = Math.min( LEVEL_MAP[ 0 ].length - 1, Math.ceil( ( cameraX + w ) / TILE_SIZE ) );

	for ( let row = 0; row < LEVEL_MAP.length; row++ ) {
		for ( let col = startCol; col <= endCol; col++ ) {
			const tile = getTile( col, row );
			if ( tile !== 1 && tile !== 2 ) continue;

			const tx = col * TILE_SIZE - cameraX;
			const ty = row * TILE_SIZE;

			if ( tile === 1 ) {
				// Check if tile above is empty (top surface)
				const above = getTile( col, row - 1 );
				if ( ! ( above === 1 ) ) {
					ctx.fillStyle = COLORS.groundTop;
					ctx.fillRect( tx, ty, TILE_SIZE, 8 );
					ctx.fillStyle = COLORS.ground;
					ctx.fillRect( tx, ty + 8, TILE_SIZE, TILE_SIZE - 8 );
					// Grass tufts
					ctx.fillStyle = '#5a9e30';
					ctx.fillRect( tx + 4, ty, 4, 4 );
					ctx.fillRect( tx + 12, ty - 2, 4, 5 );
					ctx.fillRect( tx + 22, ty, 4, 4 );
				} else {
					ctx.fillStyle = COLORS.ground;
					ctx.fillRect( tx, ty, TILE_SIZE, TILE_SIZE );
				}
				// Brick lines
				ctx.strokeStyle = 'rgba(0,0,0,0.15)';
				ctx.lineWidth = 1;
				ctx.strokeRect( tx + 0.5, ty + 0.5, TILE_SIZE - 1, TILE_SIZE - 1 );
			} else {
				// Platform
				ctx.fillStyle = COLORS.platformTop;
				ctx.fillRect( tx, ty, TILE_SIZE, 6 );
				ctx.fillStyle = COLORS.platform;
				ctx.fillRect( tx, ty + 6, TILE_SIZE, TILE_SIZE - 6 );
				ctx.strokeStyle = 'rgba(0,0,0,0.2)';
				ctx.lineWidth = 1;
				ctx.strokeRect( tx + 0.5, ty + 0.5, TILE_SIZE - 1, TILE_SIZE - 1 );
			}
		}
	}
}

function drawWapuu( ctx: CanvasRenderingContext2D, p: Player, cameraX: number ) {
	const sx = Math.round( p.x - cameraX );
	const sy = Math.round( p.y );
	const blink = p.invincibleTimer > 0 && Math.floor( p.invincibleTimer / 4 ) % 2 === 0;
	if ( blink ) return;

	ctx.save();
	if ( ! p.facingRight ) {
		ctx.translate( sx + p.w / 2, 0 );
		ctx.scale( -1, 1 );
		ctx.translate( -( sx + p.w / 2 ), 0 );
	}

	const x = sx;
	const y = sy;

	// Body
	ctx.fillStyle = COLORS.wapuuBody;
	ctx.beginPath();
	ctx.roundRect( x + 4, y + 12, 20, 16, 4 );
	ctx.fill();

	// Belly
	ctx.fillStyle = COLORS.wapuuBelly;
	ctx.beginPath();
	ctx.ellipse( x + 14, y + 20, 7, 6, 0, 0, Math.PI * 2 );
	ctx.fill();

	// Head
	ctx.fillStyle = COLORS.wapuuBody;
	ctx.beginPath();
	ctx.roundRect( x + 3, y + 1, 22, 18, 8 );
	ctx.fill();

	// Ears
	ctx.fillStyle = COLORS.wapuuEar;
	ctx.beginPath();
	ctx.ellipse( x + 5, y + 5, 4, 5, -0.4, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse( x + 23, y + 5, 4, 5, 0.4, 0, Math.PI * 2 );
	ctx.fill();

	// Hat (WordPress blue)
	ctx.fillStyle = COLORS.wapuuHat;
	ctx.beginPath();
	ctx.roundRect( x + 3, y - 3, 22, 9, [ 4, 4, 0, 0 ] );
	ctx.fill();
	ctx.fillRect( x + 1, y + 5, 26, 4 );

	// Eyes
	ctx.fillStyle = COLORS.wapuuEye;
	ctx.beginPath();
	ctx.ellipse( x + 10, y + 10, 3, 3.5, 0, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse( x + 20, y + 10, 3, 3.5, 0, 0, Math.PI * 2 );
	ctx.fill();
	// Pupils
	ctx.fillStyle = '#000';
	ctx.beginPath();
	ctx.ellipse( x + 11, y + 11, 1.5, 1.5, 0, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse( x + 21, y + 11, 1.5, 1.5, 0, 0, Math.PI * 2 );
	ctx.fill();

	// Paws
	const legOffset = p.state === 'run' ? Math.sin( p.animFrame * 0.8 ) * 4 : 0;
	ctx.fillStyle = COLORS.wapuuPaw;
	ctx.beginPath();
	ctx.ellipse( x + 8, y + 28 + legOffset, 4, 3, 0, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse( x + 20, y + 28 - legOffset, 4, 3, 0, 0, Math.PI * 2 );
	ctx.fill();

	// Jump pose: raise arms
	if ( p.state === 'jump' ) {
		ctx.fillStyle = COLORS.wapuuPaw;
		ctx.beginPath();
		ctx.ellipse( x + 2, y + 14, 3, 4, -0.5, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse( x + 26, y + 14, 3, 4, 0.5, 0, Math.PI * 2 );
		ctx.fill();
	}

	ctx.restore();
}

function drawEnemy( ctx: CanvasRenderingContext2D, e: Enemy, cameraX: number ) {
	const x = Math.round( e.x - cameraX );
	const y = Math.round( e.y );

	// Slime body
	ctx.fillStyle = COLORS.enemyBody;
	ctx.beginPath();
	ctx.ellipse( x + e.w / 2, y + e.h * 0.6, e.w / 2, e.h * 0.6, 0, Math.PI, 0 );
	ctx.arc( x + e.w / 2, y + e.h * 0.4, e.w / 2, 0, Math.PI );
	ctx.fill();

	// Eyes
	const eyeBob = Math.sin( e.animFrame * 0.5 ) * 1;
	ctx.fillStyle = COLORS.enemyEye;
	ctx.beginPath();
	ctx.ellipse( x + 8, y + 10 + eyeBob, 3, 3.5, 0, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse( x + 20, y + 10 + eyeBob, 3, 3.5, 0, 0, Math.PI * 2 );
	ctx.fill();
	ctx.fillStyle = '#300';
	ctx.beginPath();
	ctx.ellipse( x + 9, y + 11 + eyeBob, 1.5, 1.5, 0, 0, Math.PI * 2 );
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse( x + 21, y + 11 + eyeBob, 1.5, 1.5, 0, 0, Math.PI * 2 );
	ctx.fill();
}

function drawCollectible( ctx: CanvasRenderingContext2D, c: Collectible, cameraX: number ) {
	const x = Math.round( c.x - cameraX );
	const y = Math.round( c.y ) + Math.sin( c.animFrame * 0.05 ) * 3;
	const r = c.w / 2;

	// Coin circle
	ctx.fillStyle = COLORS.collectible;
	ctx.beginPath();
	ctx.arc( x + r, y + r, r, 0, Math.PI * 2 );
	ctx.fill();

	// "W" letter
	ctx.fillStyle = '#fff';
	ctx.font = `bold ${ Math.round( r * 1.2 ) }px monospace`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( 'W', x + r, y + r + 1 );
}

function drawFlag( ctx: CanvasRenderingContext2D, flag: Flag, cameraX: number ) {
	const x = Math.round( flag.x - cameraX );
	const y = Math.round( flag.y );

	// Pole
	ctx.fillStyle = COLORS.flagPole;
	ctx.fillRect( x + 14, y, 4, flag.h );

	// Banner wave
	const wave = Math.sin( flag.animFrame * 0.05 ) * 3;
	ctx.fillStyle = COLORS.flagBanner;
	ctx.beginPath();
	ctx.moveTo( x + 18, y + 4 );
	ctx.lineTo( x + 18 + 16 + wave, y + 10 );
	ctx.lineTo( x + 18, y + 18 );
	ctx.closePath();
	ctx.fill();
}

function drawHud( ctx: CanvasRenderingContext2D, score: number, lives: number, w: number ) {
	ctx.fillStyle = COLORS.hud;
	ctx.fillRect( 0, 0, w, 28 );

	ctx.fillStyle = COLORS.hudText;
	ctx.font = 'bold 14px monospace';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText( `♥ ${ lives }`, 10, 14 );
	ctx.textAlign = 'right';
	ctx.fillText( `${ score } pts`, w - 10, 14 );
}

export function renderGame(
	ctx: CanvasRenderingContext2D,
	state: {
		player: Player;
		enemies: Enemy[];
		collectibles: Collectible[];
		flag: Flag | null;
		score: number;
		cameraX: number;
	},
	w: number,
	h: number
) {
	const { player, enemies, collectibles, flag, score, cameraX } = state;

	ctx.clearRect( 0, 0, w, h );
	drawBackground( ctx, cameraX, w, h );
	drawTiles( ctx, cameraX, w, h );

	for ( const c of collectibles ) {
		if ( ! c.collected ) drawCollectible( ctx, c, cameraX );
	}
	if ( flag ) drawFlag( ctx, flag, cameraX );
	for ( const e of enemies ) {
		if ( e.alive ) drawEnemy( ctx, e, cameraX );
	}

	drawWapuu( ctx, player, cameraX );
	drawHud( ctx, score, player.lives, w );
}

export function renderDeathScreen( ctx: CanvasRenderingContext2D, w: number, h: number ) {
	ctx.fillStyle = 'rgba(0,0,0,0.7)';
	ctx.fillRect( 0, 0, w, h );
	ctx.fillStyle = '#ff4444';
	ctx.font = 'bold 28px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( 'GAME OVER', w / 2, h / 2 - 20 );
	ctx.fillStyle = '#fff';
	ctx.font = '16px monospace';
	ctx.fillText( 'Press Enter or Space to retry', w / 2, h / 2 + 16 );
}

export const WIN_LINK = { url: 'https://wapuu.studio', y: 0, h: 20 };

export function renderWinScreen(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	score: number
) {
	ctx.fillStyle = 'rgba(0,0,0,0.7)';
	ctx.fillRect( 0, 0, w, h );
	ctx.fillStyle = '#f5a623';
	ctx.font = 'bold 28px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( '🎉 YOU WIN! 🎉', w / 2, h / 2 - 44 );
	ctx.fillStyle = '#fff';
	ctx.font = '18px monospace';
	ctx.fillText( `Score: ${ score }`, w / 2, h / 2 - 10 );
	ctx.font = '13px monospace';
	ctx.fillText( 'Press Enter or Space to play again', w / 2, h / 2 + 18 );
	ctx.fillStyle = '#aad4f5';
	ctx.font = '12px monospace';
	ctx.fillText( 'Want your own Wapuu? Visit', w / 2, h / 2 + 46 );
	// Underlined link
	ctx.fillStyle = '#f5a623';
	ctx.font = 'bold 13px monospace';
	const linkY = h / 2 + 66;
	ctx.fillText( 'wapuu.studio', w / 2, linkY );
	const linkW = ctx.measureText( 'wapuu.studio' ).width;
	ctx.fillRect( w / 2 - linkW / 2, linkY + 8, linkW, 1 );
	WIN_LINK.y = linkY - 10;
	WIN_LINK.h = 22;
}
