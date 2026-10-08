import { startApp } from '@/app';
import { createIpcConnector } from '@/data/core/connectors/ipc';

startApp( createIpcConnector() );
