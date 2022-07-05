import { EventEmitter } from "events";
import { LinkedList } from "llibdatastructures";
import { SmtpClientCommanderAssignment } from "./SmtpCommanderAssignment";
import {
  SmtpClientCommander,
  SmtpClientCommanderOptions,
} from "./SmtpClientCommander";
import { SmtpClient, SmtpClientOptions } from "./SmtpClient";
import { SmtpMailExchanges } from "../SmtpMailExchanges";
import { MxRecord } from "dns";
import winston from "winston";

export interface SmtpClientPoolOptions {
  client_options?: SmtpClientOptions;
  commander_options?: SmtpClientCommanderOptions;
}

export declare interface SmtpClientPool {
  on(event: "destroy", listener: () => void): this;

  once(event: "destroy", listener: () => void): this;
}

export class SmtpClientPool extends EventEmitter {
  protected _exchanges: SmtpMailExchanges;
  protected _port: number;
  protected _secure: boolean;

  protected _client_options?: SmtpClientOptions;
  protected _commander_options?: SmtpClientCommanderOptions;
  protected _logger?: winston.Logger;

  protected _nodes: LinkedList<SmtpClientCommander> =
    new LinkedList<SmtpClientCommander>();

  /**
   * Constructs a new SmtpClientPool with the given connect options.
   * @param exchanges the mail exchanges.
   * @param port the port.
   * @param secure the secure option.
   * @param options the options.
   */
  public constructor(
    exchanges: SmtpMailExchanges,
    port: number,
    secure: boolean = false,
    options: SmtpClientPoolOptions = {},
    logger?: winston.Logger
  ) {
    super();

    // Sets the hostname and port.
    this._exchanges = exchanges;
    this._port = port;
    this._secure = secure;

    // Sets the options.
    this._client_options = options.client_options;
    this._commander_options = options.commander_options;
    this._logger = logger;

    // Logs the base.
    this._logger?.debug(
      `Client pool created for ${this._secure ? "TLS" : "PLAIN"} ${
        this._exchanges.hostname
      }:${this._port}`
    );
  }

  /**
   * Gets called when a commander emits the destroy event.
   * @param commander the commander.
   * @protected
   */
  protected _on_commander_destroy(commander: SmtpClientCommander): void {
    // Removes the commander from the list, to prevent confusion.
    this._nodes.remove(commander);

    // Checks if there are assignments left in the queue, if not return.
    if (commander.assignment_queue.empty) {
      return;
    }

    // Enqueue all the remaining assignments to different commanders.
    this._logger?.debug(
      `Transferring unhandled assignments to new clients ...`
    );
    while (!commander.assignment_queue.empty) {
      this.assign(commander.assignment_queue.dequeue());
    }
  }

  /**
   * Assigns a new assignment to the pool.
   * @param assignment the assignment.
   */
  public assign(assignment: SmtpClientCommanderAssignment): void {
    // Logs the message indicating where the assignment is going towards.
    this._logger?.debug(
      `We've received a new assignment to: (${assignment.to.join(", ")})`
    );

    // Checks if there is space left in the current head, if so just enqueue
    //  it to the current head.
    if (!this._nodes.empty && !this._nodes.head.max_assignments_reached) {
      const head_commander: SmtpClientCommander = this._nodes.head;
      return head_commander.assign(assignment);
    }

    // Since there is no space or no current commander available, we create
    //  a new one, first we'll get the exchange.
    const exchange: MxRecord = this._exchanges.exchange;
    this._logger?.debug(
      `Creating new commander for exchange '${exchange.exchange}' with priority ${exchange.priority}`
    );

    // Creates the client and gives it the options the callee has specified.
    const client: SmtpClient = new SmtpClient(this._client_options, this._logger);

    // Creates the commander for the client, and give it the callee specified
    //  options, since we don't have any ourselves.
    const commander: SmtpClientCommander = new SmtpClientCommander(
      client,
      this._commander_options,
      this._logger
    );

    // Pushes the assignment to the commander, and inserts the commander
    //  to the internal commander list.
    commander.assign(assignment);
    this._nodes.push_head(commander);

    // Creates the event listeners, and triggers the connection.
    commander.once("destroy", (): void =>
      this._on_commander_destroy(commander)
    );
    client.connect(exchange.exchange, this._port, this._secure);
  }
}
