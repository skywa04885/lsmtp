import EventEmitter from "events";
import { Flags } from "../helpers/Flags";
import { Logger } from "../helpers/Logger";
import { SmtpCapability } from "../shared/SmtpCapability";
import { SmtpResponse } from "../shared/SmtpResponse";
import { SmtpClient, SmtpClientOptions } from "./SmtpClient";
import {
  SmtpCommanderServerFeatures,
  SmtpCommanderServerOpts,
  smtp_client_server_opts_from_capabilities,
  smtp_commander_server_opts_flags_string,
} from "./SmtpClientServerConfig";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";
import { Queue } from "../helpers/Queue";
import {DotEscapeEncodeStream} from "llibencoding";

export enum SmtpCommanderFlag {
  IS_ESMTP = 1 << 0, // The server is an ESMTP server.
  IS_SMTP = 1 << 1, // The server is an SMTP server.
  SUPPORTS_STARTTLS = 1 << 2, // If the server supports STARTTLS
  TRANSACTION_HAPPENED = 1 << 3,
}

export declare interface SmtpClientCommander {
  on(event: "destroy", listener: () => void): this;
  on(event: "ready", listener: () => void): this;
}

export interface SmtpCLientCommanderOptions {
  server_domain?: string;
  debug?: boolean;
  noop_interval?: number;
}

export class SmtpClientCommander extends EventEmitter {
  protected _server_domain: string;
  protected _debug: boolean;
  protected _noop_interval: number;

  protected _smtp_client: SmtpClient;
  protected _logger?: Logger;
  protected _flags: Flags;
  protected _server_opts?: SmtpCommanderServerOpts;
  protected _timer_ref?: NodeJS.Timeout;
  protected _assignment_queue: Queue<SmtpClientAssignment>;

  public constructor(
    smtp_client: SmtpClient,
    options: SmtpCLientCommanderOptions = {}
  ) {
    super();

    // Sets the options.
    this._server_domain = options.server_domain ?? "unset.local";
    this._debug = options.debug ?? false;
    this._noop_interval = options.noop_interval ?? 5000;

    // Creates the logger if debugging enabled.
    if (this._debug) {
      this._logger = new Logger("SmtpClientCommander");
    }

    // Assigns the SMTP client.
    this._smtp_client = smtp_client;

    // Sets the default variable values.
    this._flags = new Flags();
    this._assignment_queue = new Queue<SmtpClientAssignment>();

    // Registers the events.
    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._handle_greeting(response)
    );
  }

  public assign(assignment: SmtpClientAssignment) {
    this._logger?.trace(
      `Got new assignment, from: ${assignment.from}, to: ${assignment.to.join(
        ", "
      )}.`
    );

    // Enqueues the assignment.
    this._assignment_queue.enqueue(assignment);

    // Checks if the queue is empty, if so we can just enter transmission mode immediately
    //  since there is nothing going on now.
    if (this._assignment_queue.size === 1) {
      // Performs the debug log.
      this._logger?.trace(
        `Immediately executing enqueued assignment because the client is IDLE now.`
      );

      // Starts the transaction.
      this._transaction_begin(this._assignment_queue.peek());
    }
  }

  ////////////////////////////////////////////////
  // Getters.
  ////////////////////////////////////////////////

  /**
   * Checks if the SMTP-UTF8 feature is enabled on the server.
   */
  public get supports_smtp_utf8(): boolean {
    return this._server_opts!.features.are_set(SmtpCommanderServerFeatures.SMTP_UTF8);
  }

  ////////////////////////////////////////////////
  // General Handlers.
  ////////////////////////////////////////////////

  protected _handle_noop(response: SmtpResponse): void {
    // Logs that we've received the ACK.
    this._logger?.trace(`Received NOOP response, setting timeout again ..`);

    // Sets the NOOP timeout.
    this._set_noop_timeout();
  }

  protected _set_noop_timeout(): void {
    this._timer_ref = setTimeout(() => {
      // Logs that we're sending the NOOP
      this._logger?.trace(`Sent NOOP, awaiting response ...`);

      // Sends the NOOP and adds the event listener.
      this._smtp_client.cmd_noop();
      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_noop(response)
      );
    }, this._noop_interval);
  }

  /**
   * Gets called when either the client is ready, or an transmission is done.
   * @param initial if this was called from the initial phase.
   * @protected
   */
  protected _handle_done(initial: boolean) {
    // If it was the initial, emit the ready event, else pop off the message
    //  in the queue.
    if (initial) {
      this.emit('ready');
      return;
    } else {
      this._logger?.trace(`Transmission complete, dequeue assignment ...`);
      this._assignment_queue.dequeue();
    }

    // Checks if there are more messages in the queue, if not enter IDLE mode, else
    //  start the transmission of the next assignment.
    if (this._assignment_queue.empty) {
      // Logs that we're entering IDLE mode, if in debug.
      this._logger?.trace(
        `Assignment queue is empty, entering IDLE mode with NOOP interval of ${this._noop_interval}ms`
      );

      // Sets the NOOP timeout, and return.
      this._set_noop_timeout();
      return;
    }

    // The queue is not empty start next transaction.
    this._transaction_begin(this._assignment_queue.peek());
  }

  ////////////////////////////////////////////////
  // Transaction Handlers.
  ////////////////////////////////////////////////

  /**
   * Begins an transaction for the given assignment.
   * @param assignment the assignment.
   * @protected
   */
  protected _transaction_begin(assignment: SmtpClientAssignment): void {
    // Checks if this is the first transaction, if so begin immediately, and clear the flag.
    if (this._flags.are_clear(SmtpCommanderFlag.TRANSACTION_HAPPENED)) {
      this._flags.set(SmtpCommanderFlag.TRANSACTION_HAPPENED);
      this._transaction_send_from(assignment);
      return;
    }

    // Sends the RSET command first.
    this._transaction_send_rset(assignment);
  }

  protected _transaction_send_rset(assignment: SmtpClientAssignment) {
    this._logger?.trace(`Sending RSET command to reset session ...`);

    this._smtp_client.once('response', (response: SmtpResponse) => this._transaction_handle_rset_response(assignment, response));
    this._smtp_client.cmd_rset();
  }

  protected _transaction_handle_rset_response(assignment: SmtpClientAssignment, response: SmtpResponse) {
    this._logger?.trace(`Received RSET Response, beginning transaction ...`);

    // Sends the from.
    this._transaction_send_from(assignment);
  }

  protected _transaction_send_from(assignment: SmtpClientAssignment) {
    this._logger?.trace(`Sending mail from command ...`);

    this._smtp_client.once('response', (response: SmtpResponse) => this._transaction_handle_from_response(assignment, response));
    this._smtp_client.cmd_mail_from(assignment.from);
  }

  protected _transaction_handle_from_response(assignment: SmtpClientAssignment, response: SmtpResponse): void {
    this._logger?.trace(`Received mail from response, starting with RCPT to ...`);

    // Bootstraps the RCPT to sequence, by default the index will be zero, but this will increase
    //  each RCPT TO we send, until we've reached the number of recipients and proceed to DATA/ BDAT.
    this._transaction_send_rcpt_to(assignment);
  }

  protected _transaction_send_rcpt_to(assignment: SmtpClientAssignment, index: number = 0): void {
    this._logger?.trace(`Sending recipient (${index}): ${assignment.to[index]}`);

    this._smtp_client.once('response', (response: SmtpResponse) => this._transaction_handle_rcpt_to(assignment, index));
    this._smtp_client.cmd_rcpt_to(assignment.to[index]);
  }

  protected _transaction_handle_rcpt_to(assignment: SmtpClientAssignment, index: number): void {
    this._logger?.trace(`Received recipient response (${index}): ${assignment.to[index]}`);

    // Checks if there is another recipient to send, if so trigger that.
    if (index + 1 < assignment.to.length) {
      this._transaction_send_rcpt_to(assignment, ++index);
      return;
    }

    // Since we're done with the recipients, check how many actually succeeded, and if none were
    //  valid stop executing and call error callback.

    // Checks if the server supports chunking, if so start streaming it out in chunks, else use the data command.
    if (false && this._server_opts!.features.are_set(SmtpCommanderServerFeatures.Chunking)) {

    } else {
      this._transaction_send_data(assignment);
    }
  }

  protected _transaction_send_data(assignment: SmtpClientAssignment): void {
    this._logger?.trace(`Sending data command ...`);

    this._smtp_client.once('response', (response: SmtpResponse) => this._transaction_handle_data_response(assignment, response));
    this._smtp_client.cmd_data();
  }

  protected _transaction_handle_data_response(assignment: SmtpClientAssignment, response: SmtpResponse): void {
    this._logger?.trace('Received data command, started streaming out data ...');

    // Sets the response handler for after the data command.
    this._smtp_client.once('response', (response: SmtpResponse) => this._transaction_handle_data_complete_response(assignment, response));

    // Creates the dot escape stream (escapes dots in the SMTP message).
    const encoder: DotEscapeEncodeStream = new DotEscapeEncodeStream({
      buffer_output: true,
    });

    // Pipes the encoder output to the socket.
    encoder.on('data', (chunk: Buffer) => this._smtp_client.smtp_socket.socket!.write(chunk));
    encoder.on('end', () => {
      this._smtp_client.smtp_socket.write('.\r\n');
    })

    // Pipes the data to the encoder.
    assignment.data.pipe(encoder);
  }

  protected _transaction_handle_data_complete_response(assignment: SmtpClientAssignment, response: SmtpResponse): void {
    this._logger?.trace('Received data complete response.');

    // Calls the handle done, and maybe starts the transmission of another message.
    this._handle_done(false);
  }

  ////////////////////////////////////////////////
  // Pre-Transaction Handlers.
  ////////////////////////////////////////////////

  protected _handle_starttls_upgrade() {
    // Logs that we've upgraded the connection.
    this._logger?.trace("Connection is now upgraded, sending new EHLO ...");

    // Writes the HELO command, to receive the new capabilities.
    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._handle_ehlo(response)
    );
    this._smtp_client.cmd_ehlo(this._server_domain);
  }

  /**
   * Gets called when the starttls response is received.
   */
  protected _handle_starttls_response(response: SmtpResponse) {
    // Logs that we've received the STARTTLS response.
    this._logger?.trace(
      "STARTTLS Response received, upgrading connection ..."
    );

    // Upgrades the connection.
    this._smtp_client.once("upgrade", () => this._handle_starttls_upgrade());
    this._smtp_client.upgrade();
  }

  /**
   * Gets called when the EHLO response has been returned.
   * @param response the response.
   */
  protected _handle_ehlo(response: SmtpResponse) {
    // Logs that we've received the EHLO, if debug enabled.
    this._logger?.trace("Received EHLO, checking capabilities ...");

    // Decodes the capabilities.
    const capabilities: SmtpCapability[] = SmtpCapability.decode_many(
      response.message as string[],
      1 /* Skip the initial line, there is nothing there. */
    );

    // Derives the server options from the capabilities, and logs
    //  them to the console if debug enabled.
    this._server_opts = smtp_client_server_opts_from_capabilities(capabilities);
    this._logger?.trace(
      `Detected server size: ${
        this._server_opts.max_message_size
      }, with detected features: ${smtp_commander_server_opts_flags_string(
        this._server_opts
      )}`
    );

    // If we're not yet in a secure connection, check if the server supports STARTTLS, if so upgrade the connection.
    if (
      !this._smtp_client.smtp_socket.secure &&
      this._server_opts.features.are_set(SmtpCommanderServerFeatures.StartTLS)
    ) {
        this._logger?.trace("Server supports STARTTLS Upgrading ...");

      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_starttls_response(response)
      );
      this._smtp_client.cmd_start_tls();

      return;
    }

    // Calls the handle done, since we either want to enter IDLE state,
    //  or start transmission.
    this._handle_done(true);
  }

  /**
   * Gets called when the HELO response has been returned.
   * @param response the response.
   */
  protected _handle_helo(response: SmtpResponse) {
    // Logs that we've received the HELO, if debug enabled.
    this._logger?.trace(
      "Received HELO (LMFAO this server sucks so fucking hard, just support ESMTP ;P)."
    );

    // Calls the handle done, since we either want to enter IDLE state,
    //  or start transmission.
    this._handle_done(true);
  }

  /**
   * Gets called when the initial greeting is received.
   * @param response the response.
   */
  protected _handle_greeting(response: SmtpResponse) {
    // Logs that we've received the greeting, if debug enabled.
    this._logger?.trace(
      `Received greeting with message: '${response.message_string}'`
    );

    // Gets the greeting message as a string.
    const message: string = response.message_string.toLocaleLowerCase();

    // Checks if the server is SMTP or ESMTP, and sets the flags accordingly.
    this._flags.set(
      message.includes("esmtp")
        ? SmtpCommanderFlag.IS_ESMTP
        : SmtpCommanderFlag.IS_SMTP
    );

    // Writes the HELO or EHLO message depending on the type of server, and sets the listener
    //  for the response.
    if (this._flags.are_set(SmtpCommanderFlag.IS_ESMTP)) {
      this._logger?.trace("Server supports ESMTP, sending EHLO ...");

      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_ehlo(response)
      );
      this._smtp_client.cmd_ehlo(this._server_domain);
    } else if (this._flags.are_set(SmtpCommanderFlag.IS_SMTP)) {
      this._logger?.trace("Server supports SMTP only, sending HELO ...");

      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_helo(response)
      );
      this._smtp_client.cmd_helo(this._server_domain);
    }
  }
}
