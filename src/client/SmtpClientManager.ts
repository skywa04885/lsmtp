import {
  SmtpClientCommanderAssignment,
  SmtpClientAssignmentResult,
} from "./SmtpCommanderAssignment";
import { SmtpClientPool, SmtpClientPoolOptions } from "./SmtpClientPool";
import { LinkedList } from "llibdatastructures";
import { SmtpMailExchanges } from "../SmtpMailExchanges";
import winston from "winston";

export type SmtpClientManagerAssignmentCallback = (
  result: SmtpClientAssignmentResult[]
) => void;

export class SmtpClientManagerAssignment {
  protected _assignments_in_progress: LinkedList<SmtpClientCommanderAssignment> =
    new LinkedList<SmtpClientCommanderAssignment>();
  protected results: SmtpClientAssignmentResult[] = [];

  /**
   * Creates a new manager assignment.
   * @param to the recipients.
   * @param from the sender.
   * @param data the data.
   * @param callback the callback.
   */
  public constructor(
    public readonly to: string[],
    public readonly from: string,
    public readonly data: Buffer,
    public readonly callback: SmtpClientManagerAssignmentCallback
  ) {}

  /**
   * Prepares all the assignments and pushes them into the queue.
   * @returns the assignments.
   */
  public prepare_client_assignments(): SmtpClientCommanderAssignment[] {
    let result: SmtpClientCommanderAssignment[] = [];

    const dam: { [key: string]: string[] } = this.domain_address_map;
    for (const [domain, addresses] of Object.entries(dam)) {
      // Creates the assignment.
      let assignment: SmtpClientCommanderAssignment = {
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
    assignment: SmtpClientCommanderAssignment,
    result: SmtpClientAssignmentResult
  ): void {
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

  /**
   * Gets called when an assignment went wrong before actual assignment.
   * @param assignment the assignment that had a pre transition error.
   * @param error the error.
   * @returns nothing.
   */
  public on_error(assignment: SmtpClientCommanderAssignment, error: Error): void {
    // Removes the assignment from the in progress assignments.
    this._assignments_in_progress.remove(assignment);

    // Pushes the result.
    this.results.push({
      errors: [error],
    });

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
  port?: number;
  secure?: boolean;
}

export class SmtpClientManager {
  protected _map: { [key: string]: SmtpClientPool } = {};

  protected _pool_options?: SmtpClientPoolOptions;
  protected _port: number;
  protected _secure: boolean;
  protected _logger?: winston.Logger;

  /**
   * Creates a new SmtpClientManager instance.
   * @param options the options.
   * @param logger the winston logger.
   */
  public constructor(options: SmtpClientManagerOptions = {}, logger?: winston.Logger) {
    this._pool_options = options.pool_options;
    this._port = options.port ?? 25;
    this._secure = options.secure ?? false;
    this._logger = logger;
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
      this._pool_options,
      this._logger
    );
    this._map[domain] = pool;

    return pool;
  }

  /**
   * Assigns the given assignment to the given domain.
   * @param assignment the assignment.
   * @protected
   */
  protected async _assign_to_pool(
    assignment: SmtpClientCommanderAssignment
  ): Promise<void> {
    const pool: SmtpClientPool = await this._get_or_create_pool(
      assignment.domain
    );
    pool.assign(assignment);
  }

  /**
   * Assigns the given manager assignment to the pools.
   * @param man_assignment the assignments.
   */
  public async assign(
    man_assignment: SmtpClientManagerAssignment
  ): Promise<void> {
    // Gets all the client assignments from the manager assignment.
    const assignments: SmtpClientCommanderAssignment[] =
      man_assignment.prepare_client_assignments();

    // Attempts to assign all the assignments to pools.
    for (const assignment of assignments) {
      try {
        await this._assign_to_pool(assignment);
      } catch (e) {
        man_assignment.on_error(assignment, e as Error);
      }
    }
  }
}
