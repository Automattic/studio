import { DropdownMenu, Icon, MenuGroup, MenuItem } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { moreVertical, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import ProgressBar from 'src/components/progress-bar';
import { getIpcApi } from 'src/lib/get-ipc-api';
import wapuuIdleUrl from 'src/modules/wapuu-world/assets/wapuu-player-idle-sprite.png';
import { MAX_SCORE } from 'src/modules/wapuu-world/engine/game-loop';
const WAPUU_STUDIO_URL = 'https://wapuu.studio';

export function WapuuScore() {
	const { __ } = useI18n();
	const [ score, setScore ] = useState< number | undefined >( undefined );

	useEffect( () => {
		void getIpcApi()
			.getWapuuScore()
			.then( ( s: number | undefined ) => setScore( s ) );
	}, [] );

	if ( score === undefined ) {
		return null;
	}

	return (
		<div className="flex gap-3 flex-col">
			<h2 className="a8c-label-semibold flex items-center gap-1.5">
				<img
					src={ wapuuIdleUrl }
					alt=""
					width={ 16 }
					height={ 16 }
					style={ { imageRendering: 'pixelated' } }
				/>
				{ __( 'Wapuu score' ) }
			</h2>
			<div className="flex gap-3 flex-row items-center w-full">
				<div className="flex w-full flex-col gap-2">
					<div className="flex w-full flex-row justify-between gap-8">
						<div className="flex flex-row items-center text-right">
							<span className="text-frame-text-secondary">
								{ sprintf( __( '%1$d of %2$d points' ), score, MAX_SCORE ) }
							</span>
						</div>
					</div>
					<ProgressBar value={ Math.min( score, MAX_SCORE ) } maxValue={ MAX_SCORE } />
				</div>
				<DropdownMenu
					className="ml-auto flex items-center [&_button:first-child]:p-0 [&_button:first-child]:min-w-6 [&_button:first-child]:h-6"
					popoverProps={ { position: 'bottom left', resize: true } }
					icon={ <Icon icon={ moreVertical } /> }
					size={ 24 }
					label={ __( 'More options' ) }
				>
					{ ( { onClose }: { onClose: () => void } ) => (
						<MenuGroup>
							<MenuItem
								icon={ external }
								iconPosition="left"
								onClick={ () => {
									void getIpcApi().openURL( WAPUU_STUDIO_URL );
									onClose();
								} }
							>
								{ __( 'Visit wapuu.studio' ) }
							</MenuItem>
						</MenuGroup>
					) }
				</DropdownMenu>
			</div>
		</div>
	);
}
