/*
  Oh my fucking god, this code is so fucking messy... I Don't care though!
*/

import EventEmitter from "events";
import { Flags } from "llibdatastructures";
import { SmtpCapability } from "../shared/SmtpCapability";
import { SmtpResponse } from "../shared/SmtpResponse";
import { SmtpClient } from "./SmtpClient";
import {
  smtp_client_server_opts_from_capabilities,
  smtp_commander_server_opts_flags_string,
  SmtpCommanderServerFeatures,
  SmtpCommanderServerOpts,
} from "./SmtpClientServerConfig";
import {
  SmtpClientCommanderAssignment,
  SmtpClientAssignmentError,
  SmtpClientAssignmentErrorRecipientError,
  SmtpClientAssignmentTransactionError,
  SmtpClientAssignmentNetworkingError,
} from "./SmtpCommanderAssignment";
import { Queue } from "llibdatastructures";
import { DotEscapeEncodeStream } from "llibencoding";
import { Readable } from "stream";
import winston from "winston";

export enum SmtpCommanderFlag {
  IS_ESMTP = 1 << 0, // The server is an ESMTP server.
  IS_SMTP = 1 << 1, // The server is an SMTP server.
  TRANSACTION_HAPPENED = 1 << 3,
  READY = 1 << 4,
  EXECUTING = 1 << 5,
}

export declare interface SmtpClientCommander {
  on(event: "destroy", listener: () => void): this;

  on(event: "ready", listener: () => void): this;
}

export interface SmtpClientCommanderOptions {
  server_domain?: string;
  noop_interval?: number;
  max_assignments?: number;
}

export class SmtpClientCommander extends EventEmitter {
  protected _server_domain: string;
  protected _noop_interval: number;
  protected _max_assignments: number;

  protected _smtp_client: SmtpClient;
  protected _logger?: winston.Logger;
  protected _flags: Flags;
  protected _server_opts?: SmtpCommanderServerOpts;
  protected _timer_ref?: NodeJS.Timeout;
  protected _assignment_queue: Queue<SmtpClientCommanderAssignment>;
  protected _total_enqueued: number;
  protected _total_executed: number;

  protected _active_assignment_start?: Date;
  protected _active_assignment_errors?: SmtpClientAssignmentError[];
  protected _active_assignment_failed_recipients?: number;
  protected _activeAssignment: SmtpClientCommanderAssignment | null;

  public get serverDomain(): string {
    return this._server_domain;
  }

  public get noopInterval(): number {
    return this.noopInterval;
  }

  public get maxAssignments(): number {
    return this._max_assignments;
  }

  public get totalExecuted(): number {
    return this._total_executed;
  }

  public get totalEnqueued(): number {
    return this._total_enqueued;
  }

  /**
   * Constructs a new smtp client commander.
   * @param smtp_client the smtp client.
   * @param options the options.
   */
  public constructor(
    smtp_client: SmtpClient,
    options: SmtpClientCommanderOptions = {},
    logger?: winston.Logger
  ) {
    super();

    // Sets the options.
    this._server_domain = options.server_domain ?? "unset.local";
    this._noop_interval = options.noop_interval ?? 5000;
    this._max_assignments = options.max_assignments ?? 100;

    // Sets the logger.
    this._logger = logger;
    
    // Assigns the SMTP client.
    this._smtp_client = smtp_client;

    // Sets the default variable values.
    this._flags = new Flags();
    this._assignment_queue = new Queue<SmtpClientCommanderAssignment>();
    this._total_enqueued = this._total_executed = 0;
    this._activeAssignment = null;

    // Registers the events.
    this._smtp_client.once("close", () => this._handle_close());
    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._handle_greeting(response)
    );
  }

  /**
   * Assigns a new assignment to the commander.
   * @param assignment the assignment.
   */
  public assign(assignment: SmtpClientCommanderAssignment) {
    this._logger?.debug(
      `Got new assignment, from: ${assignment.from}, to: ${assignment.to.join(
        ", "
      )}.`
    );

    // Enqueues the assignment, and increases the number of enqueued assignments.
    this._assignment_queue.enqueue(assignment);
    ++this._total_enqueued;

    // Checks if the queue is empty, if so we can just enter transmission mode immediately
    //  since there is nothing going on now.
    if (
      this._assignment_queue.size === 1 &&
      this._flags.are_set(SmtpCommanderFlag.READY)
    ) {
      // Cancels the NOOP timer.
      this._timer_ref?.unref();
      this._timer_ref = undefined;

      // Performs the debug log.
      this._logger?.debug(
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
   * Checks if we've reached the max number of assignments.
   */
  public get max_assignments_reached(): boolean {
    return this._total_enqueued >= this._max_assignments;
  }

  /**
   * Gets the assignment queue.
   */
  public get assignment_queue(): Queue<SmtpClientCommanderAssignment> {
    return this._assignment_queue;
  }

  /**
   * Gets the number of total enqueued assignments.
   */
  public get total_enqueued(): number {
    return this._total_enqueued;
  }

  /**
   * Gets the max number of assignments.
   */
  public get max_assignments(): number {
    return this._max_assignments;
  }

  ////////////////////////////////////////////////
  // General Handlers.
  ////////////////////////////////////////////////

  /**
   * Gets called when we should give up an transaction.
   * @param error the error.
   */
  protected _give_up_transaction(error: SmtpClientAssignmentError): void {
    // Pushes the error.
    this._active_assignment_errors!.push(error as SmtpClientAssignmentError);

    // Ends the current transaction.
    this._handle_done(false);
  }

  /**
   * Gets called when an error occured in the socket level.
   * @param error the error.
   */
  protected _handle_error(error: Error): void {
    // If executing, add an error.
    if (this._flags.are_set(SmtpCommanderFlag.EXECUTING)) {
      this._logger?.error("An error occured during the transaction, closing ...");

      // Pushes the error onto the errors array, and finishes
      //  the transaction.
      this._active_assignment_errors!.push(
        new SmtpClientAssignmentNetworkingError(
          `An error occured during the transmission: ${error.name} - ${error.message}`
        )
      );
      this._transaction_finish();
    }    

    // Closes the socket, which will handle the rest, including the destroy.
    this._smtp_client.smtp_socket.close();
  }

  /**
   * Handles the close event of the socket.
   */
  protected _handle_close(): void {
    // If executing, finish the assignment with an error.
    if (this._flags.are_set(SmtpCommanderFlag.EXECUTING)) {
      this._logger?.error("Transaction closed prematurely.");

      // Pushes the error onto the errors array, and finishes
      //  the transaction.
      this._active_assignment_errors!.push(
        new SmtpClientAssignmentNetworkingError(
          "Socket closed during transaction."
        )
      );
      this._transaction_finish();
    }

    // Emits the destroy event.
    this.emit("destroy");
  }

  /**
   * Handles the NOOP response.
   * @param response the response.
   */
  protected _handle_noop(response: SmtpResponse): void {
    // Logs that we've received the ACK.
    this._logger?.debug(`Received NOOP response, setting timeout again ..`);

    // Checks if the status is okay, if not quit.
    if (response.status !== 250) {
      this._smtp_client.cmd_quit();
      return;
    }

    // Sets the NOOP timeout.
    this._set_noop_timeout();
  }

  /**
   * Sets the new timeout for sending the next NOOP.
   * @protected
   */
  protected _set_noop_timeout(): void {
    this._timer_ref = setTimeout(() => {
      // Logs that we're sending the NOOP
      this._logger?.debug(`Sent NOOP, awaiting response ...`);

      // Sends the NOOP and adds the event listener.
      this._smtp_client.cmd_noop();
      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_noop(response)
      );
    }, this._noop_interval);
  }

  /**
   * Finishes the ongoing assignment and calls the callback.
   * @protected
   */
  protected _transaction_finish(): void {
    // Calls the assignment callback.
    this._assignment_queue.peek().callback({
      to: this._activeAssignment!.to,
      transfer_start: this._active_assignment_start!,
      transfer_end: new Date(),
      errors: this._active_assignment_errors!,
    });

    // Clears the active assignment.
    this._activeAssignment = null;

    // Sets the executing bit to false.
    this._flags.clear(SmtpCommanderFlag.EXECUTING);

    // Dequeues the assignment.
    this._logger?.debug(`Transmission complete, dequeue assignment ...`);
    this._assignment_queue.dequeue();
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
      // Emits the ready event.
      this.emit("ready");

      // Sets the ready flag.
      this._flags.set(SmtpCommanderFlag.READY);
    } else {
      // Finishes the assignment.
      this._transaction_finish();

      // If we've executed the max number of assignments, close.
      if (++this._total_executed >= this._max_assignments) {
        this._logger?.debug(`Executed max number of assignments, closing ...`);
        this._smtp_client.smtp_socket.close();
        return;
      }
    }

    // Checks if there are more messages in the queue, if not enter IDLE mode, else
    //  start the transmission of the next assignment.
    if (this._assignment_queue.empty) {
      // Logs that we're entering IDLE mode, if in debug.
      this._logger?.debug(
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
  protected _transaction_begin(assignment: SmtpClientCommanderAssignment): void {
    // Sets the executing bit to true.
    this._flags.set(SmtpCommanderFlag.EXECUTING);

    // Sets the active assignment.
    this._activeAssignment = assignment;

    // Sets the start time, and the initial error array.
    this._active_assignment_start = new Date();
    this._active_assignment_errors = [];

    // Checks if this is the first transaction, if so begin immediately, and clear the flag.
    if (this._flags.are_clear(SmtpCommanderFlag.TRANSACTION_HAPPENED)) {
      this._flags.set(SmtpCommanderFlag.TRANSACTION_HAPPENED);
      this._transaction_send_from();
      return;
    }

    // Sends the RSET command first.
    this._transaction_send_rset();
  }

  /**
   * Gets called when we want to send the RSET command.
   * @protected
   */
  protected _transaction_send_rset() {
    this._logger?.debug(`Sending RSET command to reset session ...`);

    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._transaction_handle_rset_response(response)
    );
    this._smtp_client.cmd_rset();
  }

  /**
   * Gets called on an RSET response.
   * @param response the response.
   * @protected
   */
  protected _transaction_handle_rset_response(
    response: SmtpResponse
  ) {
    this._logger?.debug(`Received RSET Response, beginning transaction ...`);

    // Makes sure that the status is valid.
    if (response.status !== 250) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Status code did not match desired code: 250",
        )
      );
      return;
    }

    // Sends the from.
    this._transaction_send_from();
  }

  /**
   * Gets called when we want to send the mail from command.
   * @protected
   */
  protected _transaction_send_from() {
    this._logger?.debug(`Sending mail from command ...`);

    // Sets the response listener.
    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._transaction_handle_from_response(response)
    );

    // Sends the mail from command.
    this._smtp_client.cmd_mail_from(this._activeAssignment!.from);
  }

  /**
   * Handles the from response.
   * @param response the response.
   * @protected
   */
  protected _transaction_handle_from_response(
    response: SmtpResponse
  ): void {
    this._logger?.debug(
      `Received mail from response, starting with RCPT to ...`
    );

    // Makes sure that the status is valid.
    if (response.status !== 250) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Status code did not match desired code: 250"
        )
      );
      return;
    }

    // Bootstraps the RCPT to sequence, by default the index will be zero, but this will increase
    //  each RCPT TO we send, until we've reached the number of recipients and proceed to DATA/ BDAT.
    this._active_assignment_failed_recipients = 0;
    this._transaction_send_rcpt_to();
  }

  /**
   * Sends the RCPT to command.
   * @param index the index of the current recipient.
   * @protected
   */
  protected _transaction_send_rcpt_to(
    index: number = 0
  ): void {
    this._logger?.debug(
      `Sending recipient (${index}): ${this._activeAssignment!.to[index]}`
    );

    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._transaction_handle_rcpt_to(response, index)
    );
    this._smtp_client.cmd_rcpt_to(this._activeAssignment!.to[index]);
  }

  /**
   * Handles the RCPT to command.
   * @param assignment the assignment.
   * @param response the response.
   * @param index the to index.
   * @protected
   */
  protected _transaction_handle_rcpt_to(
    response: SmtpResponse,
    index: number
  ): void {
    this._logger?.debug(
      `Received recipient response (${index}): ${this._activeAssignment!.to[index]}`
    );

    // Makes sure that the status is valid, if not push a recipient error,
    //  and if all recipients were unreachable, we will give up.
    if (response.status !== 250) {
      // Increments the number of failed recipients.
      ++this._active_assignment_failed_recipients!;

      // Pushes the error.
      const error: SmtpClientAssignmentError =
        new SmtpClientAssignmentErrorRecipientError(
          this._activeAssignment!.to[index],
          response,
          "Response code did not match desired code: 250"
        );

      // Checks if any recipients succeeded, if not then just give up, else just
      //  push the error.
      if (this._active_assignment_failed_recipients === this._activeAssignment!.to.length) {
        this._give_up_transaction(error);
        return;
      } else {
        this._active_assignment_errors!.push(error);
      }
    }

    // Checks if there is another recipient to send, if so trigger that.
    if (index + 1 < this._activeAssignment!.to.length) {
      this._transaction_send_rcpt_to(++index);
      return;
    }

    // Since we're done with the recipients, check how many actually succeeded, and if none were
    //  valid stop executing and call error callback.

    // We only do data in this fashion, it's faster for us.
    this._transaction_send_data();
  }

  /**
   * Sends the data command.
   * @protected
   */
  protected _transaction_send_data(): void {
    this._logger?.debug(`Sending data command ...`);

    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._transaction_handle_data_response(response)
    );
    this._smtp_client.cmd_data();
  }

  /**
   * Handles the data response.
   * @param response the response.
   * @protected
   */
  protected _transaction_handle_data_response(
    response: SmtpResponse
  ): void {
    this._logger?.debug(
      "Received data command, started streaming out data ..."
    );

    // Validates the response.
    // If the status code is invalid, just give up the transaction.
    if (response.status !== 354) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Response code did not match desired code: 354"
        )
      );
      return;
    }

    // Sets the response handler for after the data command.
    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._transaction_handle_data_complete_response(response)
    );

    // Creates the dot escape stream (escapes dots in the SMTP message).
    const encoder: DotEscapeEncodeStream = new DotEscapeEncodeStream({
      buffer_output: true,
    });

    // Pipes the encoder output to the socket.
    encoder.on("data", (chunk: Buffer) =>
      this._smtp_client.smtp_socket.socket!.write(chunk)
    );
    encoder.on("end", () => {
      this._smtp_client.smtp_socket.write(".\r\n");
    });

    // Pipes the data to the encoder.
    Readable.from(this._activeAssignment!.data).pipe(encoder);
  }

  /**
   * Gets called when the data has been sent.
   * @param response the response.
   * @protected
   */
  protected _transaction_handle_data_complete_response(
    response: SmtpResponse
  ): void {
    this._logger?.debug("Received data complete response.");

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 250) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Response code did not match desired code: 250"
        )
      );
      return;
    }

    // Calls the handle done, and maybe starts the transmission of another message.
    this._handle_done(false);
  }

  ////////////////////////////////////////////////
  // Pre-Transaction Handlers.
  ////////////////////////////////////////////////

  /**
   * Handles the STARTTLS upgrade.
   * @protected
   */
  protected _handle_starttls_upgrade() {
    // Logs that we've upgraded the connection.
    this._logger?.debug("Connection is now upgraded, sending new EHLO ...");

    // Writes the HELO command, to receive the new capabilities.
    this._smtp_client.once("response", (response: SmtpResponse) =>
      this._handle_ehlo_response(response)
    );
    this._smtp_client.cmd_ehlo(this._server_domain);
  }

  /**
   * Gets called when the starttls response is received.
   */
  protected _handle_starttls_response(response: SmtpResponse) {
    // Logs that we've received the STARTTLS response.
    this._logger?.debug("STARTTLS Response received, upgrading connection ...");

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 220) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Response code did not match desired code: 220"
        )
      );
      return;
    }

    // Upgrades the connection.
    this._smtp_client.once("upgrade", () => this._handle_starttls_upgrade());
    this._smtp_client.upgrade();
  }

  /**
   * Gets called when the EHLO response has been returned.
   * @param response the response.
   */
  protected _handle_ehlo_response(response: SmtpResponse) {
    // Logs that we've received the EHLO, if debug enabled.
    this._logger?.debug("Received EHLO, checking capabilities ...");

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 250) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Response code did not match desired code: 250"
        )
      );
      return;
    }

    // Decodes the capabilities.
    const capabilities: SmtpCapability[] = SmtpCapability.decode_many(
      response.message as string[],
      1 /* Skip the initial line, there is nothing there. */
    );

    // Derives the server options from the capabilities, and logs
    //  them to the console if debug enabled.
    this._server_opts = smtp_client_server_opts_from_capabilities(capabilities);
    this._logger?.debug(
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
      this._logger?.debug("Server supports STARTTLS Upgrading ...");

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
  protected _handle_helo_response(response: SmtpResponse) {
    // Logs that we've received the HELO, if debug enabled.
    this._logger?.debug(
      "Received HELO (LMFAO this server sucks so fucking hard, just support ESMTP ;P)."
    );

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 250) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Response code did not match desired code: 250"
        )
      );
      return;
    }

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
    this._logger?.debug(
      `Received greeting with message: '${response.message_string}'`
    );

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 220) {
      this._give_up_transaction(
        new SmtpClientAssignmentTransactionError(
          response,
          "Response code did not match desired code: 220"
        )
      );
      return;
    }

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
      this._logger?.debug("Server supports ESMTP, sending EHLO ...");

      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_ehlo_response(response)
      );
      this._smtp_client.cmd_ehlo(this._server_domain);
    } else if (this._flags.are_set(SmtpCommanderFlag.IS_SMTP)) {
      this._logger?.debug("Server supports SMTP only, sending HELO ...");

      this._smtp_client.once("response", (response: SmtpResponse) =>
        this._handle_helo_response(response)
      );
      this._smtp_client.cmd_helo(this._server_domain);
    }
  }
}
