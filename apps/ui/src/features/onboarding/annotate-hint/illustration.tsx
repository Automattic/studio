import { __ } from '@wordpress/i18n';
import { MousePointer2Icon } from 'lucide-react';
import { SendIcon } from '@/lib/icons';
import styles from './style.module.css';

function BotanicalTile( { variant }: { variant: 'bloom' | 'leaves' | 'sprig' } ) {
	return (
		<svg viewBox="0 0 64 44" fill="none" className={ styles.botanical }>
			<ellipse cx="32" cy="46" rx="27" ry="14" fill="currentColor" opacity="0.12" />
			{ variant === 'bloom' ? (
				<>
					<path d="M31 43C34 32 30 23 32 16" stroke="currentColor" strokeWidth="2" />
					<path
						d="M32 33C18 34 15 25 17 23C27 22 33 27 32 33ZM32 28C43 29 48 20 45 18C35 19 31 23 32 28Z"
						fill="currentColor"
						opacity="0.5"
					/>
					<path
						d="M32 7C20 1 14 17 25 22C24 32 40 32 40 22C51 17 45 1 32 7Z"
						fill="currentColor"
						opacity="0.8"
					/>
					<circle
						cx="32"
						cy="17"
						r="4"
						fill="color-mix(in oklab, var(--accent) 10%, var(--accent-foreground))"
						opacity="0.85"
					/>
				</>
			) : variant === 'leaves' ? (
				<>
					<path
						d="M32 44V9M32 25L20 15M32 33L45 20"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					/>
					<path
						d="M32 20C20 12 28 3 32 1C39 9 40 14 32 20ZM26 23C13 25 10 14 12 8C23 8 28 14 26 23ZM36 30C34 16 45 12 52 14C52 25 46 31 36 30Z"
						fill="currentColor"
						opacity="0.85"
					/>
					<path d="M31 39C17 39 14 30 16 27C27 26 33 31 31 39Z" fill="currentColor" opacity="0.5" />
				</>
			) : (
				<>
					<path
						d="M28 44C28 30 36 26 37 10M31 31L20 23M35 23L47 17"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					/>
					<path
						d="M30 35C16 37 11 27 14 23C26 23 32 28 30 35ZM34 27C35 16 46 12 51 15C50 24 44 29 34 27Z"
						fill="currentColor"
						opacity="0.55"
					/>
					<circle cx="37" cy="10" r="7" fill="currentColor" opacity="0.85" />
					<circle cx="20" cy="22" r="5" fill="currentColor" opacity="0.7" />
					<circle cx="48" cy="16" r="5" fill="currentColor" opacity="0.85" />
				</>
			) }
		</svg>
	);
}

export function AnnotateIllustration() {
	return (
		<div className={ styles.scene }>
			<div className={ styles.window }>
				<div className={ styles.page }>
					<div className={ styles.navigation }>
						<span className={ styles.brand } />
						<span />
						<span />
						<span />
					</div>
					<div className={ styles.gallery }>
						{ ( [ 'bloom', 'leaves', 'sprig' ] as const ).map( ( variant ) => (
							<div key={ variant } className={ styles.tile }>
								<div className={ styles.thumbnail }>
									<BotanicalTile variant={ variant } />
									{ variant === 'leaves' ? <span className={ styles.marker } /> : null }
								</div>
							</div>
						) ) }
					</div>
					<MousePointer2Icon className={ styles.cursor } size={ 22 } />
				</div>
				<div className={ styles.note }>
					<span>{ __( 'Make this brighter' ) }</span>
					<span className={ styles.send }>
						<SendIcon />
					</span>
				</div>
			</div>
		</div>
	);
}
