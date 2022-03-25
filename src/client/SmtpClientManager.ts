import { SmtpClient } from "./SmtpClient";
import { SmtpClientAssignment } from "./SmtpClientAssignment";
import {SmtpClientPool} from "./SmtpClientPool";

export interface SmtpClientManagerConfig {
    server_domain: string;                          // The domain of the server.
    debug: boolean;                                 // Enable debug mode.
    max_assignments_per_client: number;             // The max number of assignments/ client (servers sometimes rate limit).
    client_keep_alive: number;                      // How long to keep a client alive.
    client_keep_alive_interval: number;             // The time between NOOPs
}

export class SmtpClientManager {
    protected _map: {[key: string]: SmtpClientPool} = {};
    public readonly config: SmtpClientManagerConfig;

    public constructor(_config: SmtpClientManagerConfig | any) {
        this.config = Object.assign({
            debug: false,
            max_messages_per_client: 6,                 // 6 messages per client before closing.
            client_keep_alive: 10 * 60 * 1000,          // 10 minutes.
            client_keep_alive_interval: 30 * 1000,      // Send NOOP every 30 seconds.
        }, _config);
    }

    /**
     * Gets a pool from the map.
     * @param hostname the hostname to search for.
     * @returns the pool.
     */
    protected get_pool(hostname: string): SmtpClientPool | null {
        return this._map[hostname.toLowerCase()] ?? null;
    }

    /**
     * Sets a pool in the map.
     * @param hostname the hostname.
     * @param pool the pool.
     */
    protected set_pool(hostname: string, pool: SmtpClientPool): void {
        this._map[hostname] = pool;
    }

    public async assign(hostname: string, assignment: SmtpClientAssignment): Promise<void> {
        // Gets the pool, and if it exists just enqueue it to it,
        //  else create a new pool.
        let pool: SmtpClientPool | null = this.get_pool(hostname);
        if (!pool) {
            // Creates the new pool.
            pool = new SmtpClientPool({
                hostname,
                max_assignments_per_client: this.config.max_assignments_per_client,
                client_keep_alive_interval: this.config.client_keep_alive_interval,
                client_keep_alive: this.config.client_keep_alive,
                debug: this.config.debug,
                server_domain: this.config.server_domain
            });

            // Inserts the pool.
            this.set_pool(hostname, pool);
        }

        // Assigns the message to the pool.
        await pool.assign(assignment);
    }
}