import { RuntimeLoader } from '@rive-app/canvas';
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';
import { useCallback, useEffect } from '@wordpress/element';
import aiImage from '../../assets/ai-icon.riv';

const useAiIcon = () => {
	const stateMachineName = 'State Machine A';

	// Configure Rive to use local WASM files
	useEffect( () => {
		RuntimeLoader.setWasmUrl( './assets/rive.wasm' );
	}, [] );

	const { rive, RiveComponent } = useRive( {
		src: aiImage,
		stateMachines: stateMachineName,
		autoplay: false,
	} );

	const inactiveInput = useStateMachineInput( rive, stateMachineName, 'inactive', false );
	const thinkingInput = useStateMachineInput( rive, stateMachineName, 'thinking', false );
	const typingInput = useStateMachineInput( rive, stateMachineName, 'typing', false );

	useEffect( () => {
		rive?.play( stateMachineName );

		return () => {
			rive?.cleanup();
		};
	}, [ rive ] );

	const setInputState = useCallback(
		( stateName: 'inactive' | 'thinking' | 'typing', value: boolean ) => {
			if ( stateName === 'inactive' && inactiveInput ) {
				// eslint-disable-next-line react-hooks/immutability
				inactiveInput.value = value;
			} else if ( stateName === 'thinking' && thinkingInput ) {
				// eslint-disable-next-line react-hooks/immutability
				thinkingInput.value = value;
			} else if ( stateName === 'typing' && typingInput ) {
				// eslint-disable-next-line react-hooks/immutability
				typingInput.value = value;
			}
		},
		[ inactiveInput, thinkingInput, typingInput ]
	);

	return {
		rive,
		RiveComponent,
		setInputState,
	};
};

export default useAiIcon;
