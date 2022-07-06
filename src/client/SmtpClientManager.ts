import {
  SmtpClientCommanderAssignment,
  SmtpClientCommanderStreamAssignment,
} from "./SmtpClientCommanderAssignment";
import { SmtpClientPool, SmtpClientPoolOptions } from "./SmtpClientPool";
import { LinkedList } from "llibdatastructures";
import { SmtpMailExchanges } from "../SmtpMailExchanges";
import winston from "winston";
import { EmailAddress } from "llibemailaddress";
import { Readable } from "stream";
import {
  SmtpClientCommanderError,
  SmtpClientCommanderNetworkingError,
  SmtpClientCommanderNetworkingErrorOrigin,
} from "./SmtpClientCommanderErrors";

export type SmtpClientManagerAssignmentCallback = () => void;

/////////////////////////////////////////////
// Assignment Base Class
/////////////////////////////////////////////

export class SmtpClientManagerAssignment {
  protected _inProgressAssignments: LinkedList<SmtpClientCommanderAssignment> =
    new LinkedList<SmtpClientCommanderAssignment>();

  /**
   * Builds the assignment, implemented by child classes.
   * @param domain the domain of the server.
   * @param from where it's sent from.
   * @param to the addresses to send to, overrides current ones.
   * @param cb the callback to call once done.
   * @protected
   */
  protected _buildAssignment(
    domain: string,
    from: EmailAddress,
    to: EmailAddress[],
    cb: () => void
  ): SmtpClientCommanderAssignment {
    throw new Error("Not implemented!");
  }

  /**
   * Creates a new manager assignment.
   * @param to the recipients.
   * @param from the sender.
   * @param callback the callback.
   */
  protected constructor(
    public readonly to: EmailAddress[],
    public readonly from: EmailAddress,
    public readonly callback: SmtpClientManagerAssignmentCallback
  ) {}

  /**
   * Prepares all the assignments and pushes them into the queue.
   * @returns the assignments.
   */
  public prepareClientAssignments(): SmtpClientCommanderAssignment[] {
    let result: SmtpClientCommanderAssignment[] = [];

    const dam: { [key: string]: EmailAddress[] } = this.domain_address_map;
    for (const [domain, addresses] of Object.entries(dam)) {
      // Creates the assignment.
      const assignment: SmtpClientCommanderAssignment = this._buildAssignment(
        domain,
        this.from,
        addresses,
        (): void => {
          this._handleAssignmentCompletion(assignment);
        }
      );

      // Pushes the assignment to the result.
      result.push(assignment);

      // Pushes the assignment to the assignments in progress.
      this._inProgressAssignments.push_head(assignment);
    }

    return result;
  }

  /**
   * Gets the map of hostnames related to each address, will be used to assign to each pool.
   * @protected
   */
  protected get domain_address_map(): { [key: string]: EmailAddress[] } {
    let map: { [key: string]: EmailAddress[] } = {};

    this.to.forEach((to: EmailAddress): void => {
      if (!map[to.hostname]) {
        map[to.hostname] = [];
      }

      map[to.hostname].push(to);
    });

    return map;
  }

  /**
   * Gets called when the given assignment has been completed.
   * @param assignment the assignment that completed.
   * @protected
   */
  protected _handleAssignmentCompletion(
    assignment: SmtpClientCommanderAssignment
  ): void {
    // Removes the assignment from the in progress assignments.
    this._inProgressAssignments.remove(assignment);

    // Checks if the manager assignment is done.
    if (!this._inProgressAssignments.empty) {
      return;
    }

    // The assignment is completed, call the callback.
    this.callback();
  }

  /**
   * Gets called when an assignment went wrong before actual assignment.
   * @param assignment the assignment that had a pre transition error.
   * @param error the error.
   * @returns nothing.
   */
  public onError(
    assignment: SmtpClientCommanderAssignment,
    error: SmtpClientCommanderError
  ): void {
    // Removes the assignment from the in progress assignments.
    this._inProgressAssignments.remove(assignment);

    // Pushes the result.
    assignment.errors.push(error);

    // Checks if the manager assignment is done.
    if (!this._inProgressAssignments.empty) {
      return;
    }

    // The assignment is completed, call the callback.
    this.callback();
  }
}

/////////////////////////////////////////////
// Assignment Stream Class
/////////////////////////////////////////////

export class SmtpClientManagerStreamAssignment extends SmtpClientManagerAssignment {
  /**
   * Creates a new manager stream assignment.
   * @param stream the stream.
   * @param to the recipients.
   * @param from the sender.
   * @param callback the callback.
   */
  public constructor(
    public readonly stream: Readable,
    to: EmailAddress[],
    from: EmailAddress,
    callback: SmtpClientManagerAssignmentCallback
  ) {
    super(to, from, callback);
  }

  /**
   * Builds the assignment, implemented by child classes.
   * @param domain the domain of the server.
   * @param from where it's sent from.
   * @param to the addresses to send to, overrides current ones.
   * @param cb the callback to call once done.
   * @protected
   */
  protected _buildAssignment(
    domain: string,
    from: EmailAddress,
    to: EmailAddress[],
    cb: () => void
  ): SmtpClientCommanderAssignment {
    return new SmtpClientCommanderStreamAssignment(
      this.stream,
      domain,
      from,
      to,
      cb
    );
  }
}

/////////////////////////////////////////////
// Assignment Buffer Class
/////////////////////////////////////////////

export class SmtpClientManagerBufferAssignment extends SmtpClientManagerAssignment {
  /**
   * Creates a new manager buffer assignment.
   * @param buffer the buffer.
   * @param to the recipients.
   * @param from the sender.
   * @param callback the callback.
   */
  public constructor(
    public readonly buffer: Buffer,
    to: EmailAddress[],
    from: EmailAddress,
    callback: SmtpClientManagerAssignmentCallback
  ) {
    super(to, from, callback);
  }
}

/////////////////////////////////////////////
// Assignment Manager
/////////////////////////////////////////////

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
   * Gets all the pools.
   */
  public get pools(): { [key: string]: SmtpClientPool } {
    return this._map;
  }

  /**
   * Creates a new SmtpClientManager instance.
   * @param options the options.
   * @param logger the winston logger.
   */
  public constructor(
    options: SmtpClientManagerOptions = {},
    logger?: winston.Logger
  ) {
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
  protected async _getOrCreatePool(domain: string): Promise<SmtpClientPool> {
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
  protected async _assignToPool(
    assignment: SmtpClientCommanderAssignment
  ): Promise<void> {
    const pool: SmtpClientPool = await this._getOrCreatePool(assignment.domain);
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
      man_assignment.prepareClientAssignments();

    // Attempts to assign all the assignments to pools.
    for (const assignment of assignments) {
      try {
        await this._assignToPool(assignment);
      } catch (e) {
        man_assignment.onError(
          assignment,
          new SmtpClientCommanderNetworkingError(
            SmtpClientCommanderNetworkingErrorOrigin.Other,
            (e as Error).message
          )
        );
      }
    }
  }
}
