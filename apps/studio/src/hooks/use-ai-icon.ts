import { RuntimeLoader } from '@rive-app/canvas';
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';
import { useEffect } from '@wordpress/element';
import aiImage from '../../assets/ai-icon.riv';

interface AiIconStates {
	inactive?: boolean;
	thinking?: boolean;
	typing?: boolean;
}

const useAiIcon = ( states: AiIconStates = {} ) => {
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

	useEffect( () => {
		if ( inactiveInput ) {
			// eslint-disable-next-line react-hooks/immutability
			inactiveInput.value = states.inactive ?? false;
		}
	}, [ inactiveInput, states.inactive ] );

	useEffect( () => {
		if ( thinkingInput ) {
			// eslint-disable-next-line react-hooks/immutability
			thinkingInput.value = states.thinking ?? false;
		}
	}, [ thinkingInput, states.thinking ] );

	useEffect( () => {
		if ( typingInput ) {
			// eslint-disable-next-line react-hooks/immutability
			typingInput.value = states.typing ?? false;
		}
	}, [ typingInput, states.typing ] );

	return {
		rive,
		RiveComponent,
	};
};

export default useAiIcon;
