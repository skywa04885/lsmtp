import { SmtpClient, SmtpClientConfig } from "./SmtpClient";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";
import {SmtpClientPool} from "./SmtpClientPool";

export interface SmtpClientManagerConfig {
    client_config?: SmtpClientConfig;
}

export class SmtpClientManager {
    protected _map: {[key: string]: SmtpClientPool} = {};

    protected _client_config?: SmtpClientConfig;

    public constructor(_config: SmtpClientManagerConfig) {
        this._client_config = _config.client_config;
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
            });

            // Inserts the pool.
            this.set_pool(hostname, pool);
        }

        // Assigns the message to the pool.
        await pool.assign(assignment);
    }
}