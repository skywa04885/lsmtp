import {
  SmtpClientAssignment,
  SmtpClientAssignmentResult,
} from "./SmtpCommanderAssignment";
import { SmtpClientPool, SmtpClientPoolOptions } from "./SmtpClientPool";
import { Logger } from "../helpers/Logger";
import { LinkedList } from "../helpers/LinkedList";
import { SmtpMailExchanges } from "../SmtpMailExchanges";

export type SmtpClientManagerAssignmentCallback = (
  result: SmtpClientAssignmentResult[]
) => void;

export class SmtpClientManagerAssignment {
  protected _assignments_in_progress: LinkedList<SmtpClientAssignment> =
    new LinkedList<SmtpClientAssignment>();
  protected results: SmtpClientAssignmentResult[] = [];

  public constructor(
    public readonly to: string[],
    public readonly from: string,
    public readonly data: Buffer,
    public readonly callback: SmtpClientManagerAssignmentCallback
  ) {}

  public prepare_client_assignments(): SmtpClientAssignment[] {
    let result: SmtpClientAssignment[] = [];

    const dam: { [key: string]: string[] } = this.domain_address_map;
    for (const [domain, addresses] of Object.entries(dam)) {
      // Creates the assignment.
      let assignment: SmtpClientAssignment = {
        domain,
        to: addresses,
        from: this.from,
        data: this.data,
        callback: (result: SmtpClientAssignmentResult) =>
          this._on_completion(assignment, result),
      };

      // Pushes the assignment to the result.
      result.push(assignment);

      // Pushes the assignment to the assignments in progress.
      this._assignments_in_progress.push_head(assignment);
    }

    return result;
  }

  /**
   * Gets the map of all different domains, and their addresses (used to enqueue to different pools).
   */
  protected get domain_address_map(): { [key: string]: string[] } {
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

  /**
   * Gets called when one SMTP client commander has completed a assignment.
   * @param assignment the assignment.
   * @param result the result of the commander.
   */
  protected _on_completion(
    assignment: SmtpClientAssignment,
    result: SmtpClientAssignmentResult
  ) {
    // Removes the assignment from the in progress assignments.
    this._assignments_in_progress.remove(assignment);

    // Pushes the result.
    this.results.push(result);

    // Checks if the manager assignment is done.
    if (!this._assignments_in_progress.empty) {
      return;
    }

    // The assignment is completed, call the callback.
    this.callback(this.results);
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

  /**
   * Creates a new SmtpClientManager instance.
   * @param options the options.
   */
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
   * Gets a pool, if not there create it.
   * @param domain the domain.
   * @protected
   */
  protected async _get_or_create_pool(domain: string): Promise<SmtpClientPool> {
    // If the pool exists, just return it.
    if (this._map[domain]) {
      return this._map[domain];
    }

    // Resolves the mail exchanges for the hostname.
    const mail_exchanges: SmtpMailExchanges = await SmtpMailExchanges.resolve(
      domain
    );

    // Creates the new pool and puts it in the map.
    const pool: SmtpClientPool = new SmtpClientPool(
      mail_exchanges,
      this._port,
      this._secure,
      this._pool_options
    );
    this._map[domain] = pool;

    return pool;
  }

  /**
   * Assigns the given assignment to the given domain.
   * @param domain the domain.
   * @param assignment the assignment.
   * @protected
   */
  protected async _assign_to_pool(
    domain: string,
    assignment: SmtpClientAssignment
  ): Promise<void> {
    const pool: SmtpClientPool = await this._get_or_create_pool(domain);
    pool.assign(assignment);
  }

  /**
   * Assigns the given manager assignment to the pools.
   * @param man_assignment the assignments.
   */
  public async assign(
    man_assignment: SmtpClientManagerAssignment
  ): Promise<void> {
    const assignments: SmtpClientAssignment[] =
      man_assignment.prepare_client_assignments();
    for (const assignment of assignments) {
      await this._assign_to_pool(assignment.domain, assignment);
    }
  }
}
