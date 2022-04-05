import { EventEmitter } from "events";
import { LinkedList } from "../helpers/LinkedList";
import { Logger } from "../helpers/Logger";
import { Queue } from "../helpers/Queue";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";
import {
  SmtpClientCommander,
  SmtpClientCommanderOptions,
} from "./SmtpClientCommander";
import { SmtpClient, SmtpClientOptions } from "./SmtpClient";

export interface SmtpClientPoolOptions {
  client_options?: SmtpClientOptions;
  commander_options?: SmtpClientCommanderOptions;
  debug?: boolean; // If debug mode enabled.
}

export declare interface SmtpClientPool {
  on(event: "destroy", listener: () => void): this;
}

export class SmtpClientPool extends EventEmitter {
  protected _hostname: string;
  protected _port: number;
  protected _secure: boolean;

  protected _client_options?: SmtpClientOptions;
  protected _commander_options?: SmtpClientCommanderOptions;
  protected _debug: boolean;
  protected _logger?: Logger;

  protected _nodes: LinkedList<SmtpClientCommander>;

  public constructor(
    hostname: string,
    port: number,
    secure: boolean = false,
    options: SmtpClientPoolOptions = {}
  ) {
    super();

    // Sets the hostname and port.
    this._hostname = hostname;
    this._port = port;
    this._secure = secure;

    // Sets the options.
    this._client_options = options.client_options;
    this._commander_options = options.commander_options;
    this._debug = options.debug ?? false;

    // Creates the logger.
    if (this._debug) {
      this._logger = new Logger(`SmtpClientPool(${this._hostname})`);
    }

    // Logs the base.
    this._logger?.trace(`Client pool created for ${this._secure ? 'TLS' : 'PLAIN'} ${this._hostname}:${this._port}`);

    // Sets the default values for the instance variables.
    this._nodes = new LinkedList<SmtpClientCommander>();
  }

  protected _assign_to_current_head(assignment: SmtpClientAssignment) {
    const head: SmtpClientCommander = this._nodes.head;
    head.assign(assignment);
  }

  protected async _create_new_head_and_assign(assignment: SmtpClientAssignment) {
    // Creates the client and the commander.
    const client: SmtpClient = new SmtpClient(this._client_options);
    const commander: SmtpClientCommander = new SmtpClientCommander(
      client,
      this._commander_options
    );

    // Assigns the assignment to the commander, and pushes the commander to the nodes.
    commander.assign(assignment);
    this._nodes.push_head(commander);

    // Sets the events for the commander.
    commander.once("destroy", (): void => {
      // Removes the commander.
      this._nodes.remove(commander);

      // Checks if there are assignments left.
      if (commander.assignment_queue.empty) {
        return;
      }

      // Enqueues the assignment to another commander.
      this._logger?.trace(`Transferring unhandled assignments to new clients ...`);
      while (!commander.assignment_queue.empty) {
        this.assign(commander.assignment_queue.dequeue());
      }
    });

    // Connects the client.
    await client.connect(this._hostname, this._port, this._secure, true);
  }

  /**
   * Assigns an assignment to the pool.
   * @param assignment the assignment.
   */
  public async assign(assignment: SmtpClientAssignment): Promise<void> {
    if (
      this._nodes.size > 0 &&
      this._nodes.head.total_enqueued < this._nodes.head.max_assignments
    ) {
      this._assign_to_current_head(assignment);
      return;
    }

    await this._create_new_head_and_assign(assignment);
  }
}
