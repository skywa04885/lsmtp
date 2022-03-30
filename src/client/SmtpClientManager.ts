import { SmtpClient } from "./SmtpClient";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";
import { SmtpClientPool, SmtpClientPoolOptions } from "./SmtpClientPool";
import { Readable } from "stream";
import { Logger } from "../helpers/Logger";

export class SmtpClientManagerAssignment {
  public constructor(
    public readonly to: string[],
    public readonly from: string,
    public readonly data: Buffer
  ) {}

  /**
   * Gets the map of all different domains, and their addresses (used to enqueue to different pools).
   */
  public get domain_address_map(): { [key: string]: string[] } {
    let map: { [key: string]: string[] } = {};

    this.to.forEach((to: string): void => {
      // Gets the index of the '@'.
      const index: number = to.indexOf("@");
      if (index === -1) {
        throw new Error("Invalid address in the array.");
      }

      // Get the domain.
      const domain: string = to
        .substring(index + 1)
        .trim()
        .toLowerCase();

      // Checks if the domain is already in the map, if not create the array.
      if (!map[domain]) {
        map[domain] = [];
      }

      // Pushes the address onto the domain.
      map[domain].push(to);
    });

    return map;
  }
}

export interface SmtpClientManagerOptions {
  pool_options?: SmtpClientPoolOptions;
  port?: 25;
  secure?: boolean;
  debug?: boolean;
}

export class SmtpClientManager {
  protected _map: { [key: string]: SmtpClientPool } = {};

  protected _pool_options?: SmtpClientPoolOptions;
  protected _port: number;
  protected _secure: boolean;
  protected _debug: boolean;

  protected _logger?: Logger;

  public constructor(options: SmtpClientManagerOptions = {}) {
    this._pool_options = options.pool_options;
    this._port = options.port ?? 25;
    this._secure = options.secure ?? false;
    this._debug = options.debug ?? false;

    if (this._debug) {
      this._logger = new Logger("SmtpClientManager");
    }
  }

  /**
   * Gets a pool from the map.
   * @param hostname the hostname to search for.
   * @returns the pool.
   */
  protected get_pool(hostname: string): SmtpClientPool | null {
    return this._map[hostname] ?? null;
  }

  /**
   * Sets a pool in the map.
   * @param hostname the hostname.
   * @param pool the pool.
   */
  protected set_pool(hostname: string, pool: SmtpClientPool): void {
    this._map[hostname] = pool;
  }

  public async assign(
    man_assignment: SmtpClientManagerAssignment
  ): Promise<void> {
    this._logger?.trace(`Received new assignment ...`);

    // Gets the map of domains and their addresses.
    const da_map: { [key: string]: string[] } =
      man_assignment.domain_address_map;

    // Goes over all the domains.
    for (const [domain, addresses] of Object.entries(da_map)) {
      this._logger?.trace(
        `Enqueueing to pool: ${domain}, assignment: ${addresses.join(", ")}`
      );

      // Creates the assignment.
      const assignment: SmtpClientAssignment = {
        to: addresses,
        from: man_assignment.from,
        data: man_assignment.data,
        callback: () => {},
      };

      // Assigns the assignment to a pool.
      let pool: SmtpClientPool | null = this.get_pool(domain);
      if (!pool) {
        pool = new SmtpClientPool(
          domain,
          this._port,
          this._secure,
          this._pool_options
        );
        this.set_pool(domain, pool);
      }

      await pool.assign(assignment);
    }
  }

  protected async _assign(
    hostname: string,
    port: number,
    secure: boolean,
    assignment: SmtpClientAssignment
  ): Promise<void> {}
}
