import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { useState } from 'react';
import { Conversation } from '@/features/chats/session-view/conversation';
import { chatSamples, sampleImage, type ChatSample } from './chat-samples';
import { renderPlayground } from './playground';
import styles from './style.module.css';

const startedAt = Date.now();

function Sample( { sample }: { sample: ChatSample } ) {
	const [ answers, setAnswers ] = useState< Record< string, string > >( {} );
	return (
		<section className={ styles.section } aria-label={ sample.title }>
			<h2 className={ styles.sectionTitle }>{ sample.title }</h2>
			<Conversation
				data={ {
					summary: {
						id: sample.title,
						filePath: '',
						createdAt: '',
						updatedAt: '',
						activeEnvironment: 'local',
						eventCount: sample.entries.length,
					},
					entries: sample.entries,
				} }
				isRunning={ !! sample.running }
				startedAt={ sample.running ? startedAt : null }
				pendingQuestions={ new Set( sample.pendingQuestions ) }
				pendingAnswers={ answers }
				freeFormQuestion={ null }
				onAnswerQuestion={ ( question, label ) =>
					setAnswers( ( current ) => ( { ...current, [ question ]: label } ) )
				}
				onChooseFreeForm={ () => {} }
			/>
		</section>
	);
}

renderPlayground(
	'Chat transcript',
	chatSamples.map( ( sample ) => <Sample key={ sample.title } sample={ sample } /> ),
	{
		readLocalMediaFile: async ( path ) => ( {
			name: path,
			mimeType: 'image/svg+xml',
			data: new TextEncoder().encode( sampleImage( path ) ).buffer as ArrayBuffer,
		} ),
	}
);
