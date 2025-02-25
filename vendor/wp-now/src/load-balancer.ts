import { WPNowServer } from './start-server';

export class LoadBalancer {
    private servers: WPNowServer[];
    private currentIndex: number;

    constructor(servers: WPNowServer[]) {
        this.servers = servers;
        this.currentIndex = 0;
    }

    getNextServer(): WPNowServer {
        const server = this.servers[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.servers.length;
        return server;
    }

    async stopAll(): Promise<void> {
        await Promise.all(this.servers.map(server => server.stopServer()));
    }
}
