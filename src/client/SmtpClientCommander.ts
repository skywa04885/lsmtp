/*
  Oh my fucking god, this code is so fucking messy... I Don't care though!
*/

import EventEmitter from "events";
import {Flags, Queue} from "llibdatastructures";
import {SmtpCapability} from "../shared/SmtpCapability";
import {SmtpResponse} from "../shared/SmtpResponse";
import {SmtpClient} from "./SmtpClient";
import {
  smtp_client_server_opts_from_capabilities,
  smtp_commander_server_opts_flags_string,
  SmtpCommanderServerFeatures,
  SmtpCommanderServerOpts,
} from "./SmtpClientServerConfig";
import {
  SmtpClientCommanderAssignment,
  SmtpClientCommanderBufferAssignment,
  SmtpClientCommanderStreamAssignment,
} from "./SmtpClientCommanderAssignment";
import {DotEscapeEncodeStream} from "llibencoding";
import {Readable} from "stream";
import winston from "winston";
import {
  SmtpClientCommanderError,
  SmtpClientCommanderNetworkingError,
  SmtpClientCommanderNetworkingErrorOrigin,
  SmtpClientCommanderTransactionError,
} from "./SmtpClientCommanderErrors";
import {SmtpCommand} from "../shared/SmtpCommand";
import {EmailAddress} from "llibemailaddress";

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
  protected _noopInterval: number;
  protected _smtpClient: SmtpClient;
  protected _logger?: winston.Logger;
  protected _flags: Flags;
  protected _serverOptions?: SmtpCommanderServerOpts;
  protected _timerReference?: NodeJS.Timeout;
  protected _activeAssignmentFailedRecipients?: number;
  protected _activeAssignment: SmtpClientCommanderAssignment | null;

  /**
   * Constructs a new smtp client commander.
   * @param smtp_client the smtp client.
   * @param options the options.
   * @param logger the logger.
   */
  public constructor(
    smtp_client: SmtpClient,
    options: SmtpClientCommanderOptions = {},
    logger?: winston.Logger
  ) {
    super();

    // Sets the options.
    this._serverDomain = options.server_domain ?? "unset.local";
    this._noopInterval = options.noop_interval ?? 5000;
    this._maxAssignments = options.max_assignments ?? 100;

    // Sets the logger.
    this._logger = logger;

    // Assigns the SMTP client.
    this._smtpClient = smtp_client;

    // Sets the default variable values.
    this._flags = new Flags();
    this._assignmentQueue = new Queue<SmtpClientCommanderAssignment>();
    this._totalEnqueuedAssignments = this._totalExecutedAssignments = 0;
    this._activeAssignment = null;

    // Registers the events.
    this._smtpClient.once("close", () => this._handleClose());
    this._smtpClient.once("response", (response: SmtpResponse) =>
      this._handleGreeting(response)
    );
  }

  protected _serverDomain: string;

  public get serverDomain(): string {
    return this._serverDomain;
  }

  protected _maxAssignments: number;

  /**
   * Gets the max number of assignments.
   */
  public get maxAssignments(): number {
    return this._maxAssignments;
  }

  protected _assignmentQueue: Queue<SmtpClientCommanderAssignment>;

  /**
   * Gets the assignment queue.
   */
  public get assignmentQueue(): Queue<SmtpClientCommanderAssignment> {
    return this._assignmentQueue;
  }

  ////////////////////////////////////////////////
  // Getters.
  ////////////////////////////////////////////////

  protected _totalEnqueuedAssignments: number;

  /**
   * Gets the number of total enqueued assignments.
   */
  public get totalEnqueuedAssignments(): number {
    return this._totalEnqueuedAssignments;
  }

  protected _totalExecutedAssignments: number;

  public get totalExecutedAssignments(): number {
    return this._totalExecutedAssignments;
  }

  /**
   * Checks if we've reached the max number of assignments.
   */
  public get max_assignments_reached(): boolean {
    return this._totalEnqueuedAssignments >= this._maxAssignments;
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
    this._assignmentQueue.enqueue(assignment);
    ++this._totalEnqueuedAssignments;

    // Checks if the queue is empty, if so we can just enter transmission mode immediately
    //  since there is nothing going on now.
    if (
      this._assignmentQueue.size === 1 &&
      this._flags.are_set(SmtpCommanderFlag.READY)
    ) {
      // Cancels the NOOP timer.
      this._timerReference?.unref();
      this._timerReference = undefined;

      // Performs the debug log.
      this._logger?.debug(
        `Immediately executing enqueued assignment because the client is IDLE now.`
      );

      // Starts the transaction.
      this._beginTransaction(this._assignmentQueue.peek());
    }
  }

  ////////////////////////////////////////////////
  // General Handlers.
  ////////////////////////////////////////////////

  /**
   * Gets called when we should give up a transaction.
   * @param error the error.
   * @protected
   */
  protected _giveUp(error: SmtpClientCommanderError): void {
    // Pushes the error to the active assignment.
    this._activeAssignment!.errors.push(error);

    // Calls the handler for the finishing of the transaction.
    this._handleDone(false);
  }

  /**
   * Gets called when a socket-level error occurred.
   * @param error the error.
   * @protected
   */
  protected _handleError(error: Error): void {
    // If executing, add an error.
    if (this._flags.are_set(SmtpCommanderFlag.EXECUTING)) {
      // Logs that we've got an error.
      this._logger?.error(
        "An error occurred during the transaction, closing ..."
      );

      // Pushes the error.
      this._activeAssignment!.errors.push(
        new SmtpClientCommanderNetworkingError(
          SmtpClientCommanderNetworkingErrorOrigin.Other,
          error.message
        )
      );

      // Finishes the transaction.
      this._finishTransaction();
    }

    // Closes the socket, which will handle the rest, including the destroy.
    this._smtpClient.smtpSocket.close();
  }

  /**
   * Handles the close event of the socket.
   * @protected
   */
  protected _handleClose(): void {
    // If executing, finish the assignment with an error.
    if (this._flags.are_set(SmtpCommanderFlag.EXECUTING)) {
      this._logger?.error("Transaction closed prematurely.");

      // Pushes an error indicating the premature closing.
      this._activeAssignment!.errors.push(
        new SmtpClientCommanderNetworkingError(
          SmtpClientCommanderNetworkingErrorOrigin.PrematureClosing,
          "The socket closed prematurely."
        )
      );

      // Finishes the transaction.
      this._finishTransaction();
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
      this._smtpClient.sendQUITCommand();
      return;
    }

    // Sets the NOOP timeout.
    this._setNOOPTimeout();
  }

  /**
   * Sets the new timeout for sending the next NOOP.
   * @protected
   */
  protected _setNOOPTimeout(): void {
    this._timerReference = setTimeout(() => {
      // Logs that we're sending the NOOP
      this._logger?.debug(`Sent NOOP, awaiting response ...`);

      // Sends the NOOP and adds the event listener.
      this._smtpClient.sendNOOPCommand();
      this._smtpClient.once("response", (response: SmtpResponse) =>
        this._handle_noop(response)
      );
    }, this._noopInterval);
  }

  /**
   * Finishes the ongoing assignment and calls the callback.
   * @protected
   */
  protected _finishTransaction(): void {
    // Calls the callback of the assignment (if there).
    if (this._activeAssignment!.cb !== null) {
      this._activeAssignment!.cb();
    }

    // Clears the active assignment.
    this._activeAssignment = null;

    // Sets the executing bit to false.
    this._flags.clear(SmtpCommanderFlag.EXECUTING);

    // Dequeues the assignment.
    this._logger?.debug(`Transmission complete, dequeue assignment ...`);
    this._assignmentQueue.dequeue();
  }

  /**
   * Gets called when either the client is ready, or an transmission is done.
   * @param initial if this was called from the initial phase.
   * @protected
   */
  protected _handleDone(initial: boolean) {
    // If it was the initial, emit the ready event, else pop off the message
    //  in the queue.
    if (initial) {
      // Emits the ready event.
      this.emit("ready");

      // Sets the ready flag.
      this._flags.set(SmtpCommanderFlag.READY);
    } else {
      // Finishes the assignment.
      this._finishTransaction();

      // If we've executed the max number of assignments, close.
      if (++this._totalExecutedAssignments >= this._maxAssignments) {
        this._logger?.debug(`Executed max number of assignments, closing ...`);
        this._smtpClient.smtpSocket.close();
        return;
      }
    }

    // Checks if there are more messages in the queue, if not enter IDLE mode, else
    //  start the transmission of the next assignment.
    if (this._assignmentQueue.empty) {
      // Logs that we're entering IDLE mode, if in debug.
      this._logger?.debug(
        `Assignment queue is empty, entering IDLE mode with NOOP interval of ${this._noopInterval}ms`
      );

      // Sets the NOOP timeout, and return.
      this._setNOOPTimeout();
      return;
    }

    // The queue is not empty start next transaction.
    this._beginTransaction(this._assignmentQueue.peek());
  }

  ////////////////////////////////////////////////
  // Transaction Handlers.
  ////////////////////////////////////////////////

  /**
   * Begins an transaction for the given assignment.
   * @param assignment the assignment.
   * @protected
   */
  protected _beginTransaction(assignment: SmtpClientCommanderAssignment): void {
    // Sets the executing bit to true.
    this._flags.set(SmtpCommanderFlag.EXECUTING);

    // Sets the active assignment.
    this._activeAssignment = assignment;

    // Checks if this is the first transaction, if so begin immediately, and clear the flag.
    if (this._flags.are_clear(SmtpCommanderFlag.TRANSACTION_HAPPENED)) {
      this._flags.set(SmtpCommanderFlag.TRANSACTION_HAPPENED);
      this._transactionSendFrom();
      return;
    }

    // Sends the RSET command first.
    this._transactionSendRSET();
  }

  /**
   * Gets called when we want to send the RSET command.
   * @protected
   */
  protected _transactionSendRSET() {
    this._logger?.debug(`Sending RSET command to reset session ...`);
    this._smtpClient.sendRSETCommand(
      (command: SmtpCommand, response: SmtpResponse) =>
        this._transactionHandleResponseRSET(command, response)
    );
  }

  /**
   * Gets called on an RSET response.
   * @param command the sent command.
   * @param response the response.
   * @protected
   */
  protected _transactionHandleResponseRSET(
    command: SmtpCommand,
    response: SmtpResponse
  ) {
    this._logger?.debug(`Received RSET Response, beginning transaction ...`);

    if (response.status !== 250) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Expected Status-Code: 250`
        )
      );
    }

    this._transactionSendFrom();
  }

  /**
   * Gets called when we want to send the mail from command.
   * @protected
   */
  protected _transactionSendFrom() {
    this._logger?.debug(`Sending mail from command ...`);
    this._smtpClient.sendMAILFROMCommand(
      this._activeAssignment!.from,
      (command: SmtpCommand, response: SmtpResponse) =>
        this._transactionHandleFromResponse(command, response)
    );
  }

  /**
   * Handles the from response.
   * @param command the sent command.
   * @param response the response.
   * @protected
   */
  protected _transactionHandleFromResponse(
    command: SmtpCommand,
    response: SmtpResponse
  ): void {
    this._logger?.debug(
      `Received mail from response, starting with RCPT to ...`
    );

    if (response.status !== 250) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Expected Status-Code: 250`
        )
      );
    }

    // Bootstraps the RCPT to sequence, by default the index will be zero, but this will increase
    //  each RCPT TO we send, until we've reached the number of recipients and proceed to DATA/ BDAT.
    this._activeAssignmentFailedRecipients = 0;
    this._transactionSendRcptTo();
  }

  /**
   * Sends the RCPT to command.
   * @param index the index of the current recipient.
   * @protected
   */
  protected _transactionSendRcptTo(index: number = 0): void {
    this._logger?.debug(
      `Sending recipient (${index}): ${this._activeAssignment!.to[index]}`
    );

    this._smtpClient.sendRCPTTOCommand(
      this._activeAssignment!.to[index],
      (command: SmtpCommand, response: SmtpResponse) =>
        this._transactionHandleRcptToResponse(command, response, index)
    );
  }

  /**
   * Handles the RCPT to command.
   * @param command the sent command.
   * @param response the response.
   * @param index the to index.
   * @protected
   */
  protected _transactionHandleRcptToResponse(
    command: SmtpCommand,
    response: SmtpResponse,
    index: number
  ): void {
    const currentTo: EmailAddress = this._activeAssignment!.to.at(index)!;

    // Logs the received response.
    this._logger?.debug(
      `Received recipient response (${index}): <${currentTo.address}>`
    );

    // Makes sure that the status is valid, if not push a recipient error,
    //  and if all recipients were unreachable, we will give up.
    if (response.status !== 250) {
      // Increments the number of failed recipients.
      ++this._activeAssignmentFailedRecipients!;

      // Pushes the error.
      this._activeAssignment!.errors.push(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Could not send to recipient: <${currentTo.address}>`
        )
      );

      // Checks if we failed all recipients, if so... Give up.
      if (
        this._activeAssignmentFailedRecipients ===
        this._activeAssignment!.to.length
      ) {
        return this._giveUp(
          new SmtpClientCommanderError(
            `${this._activeAssignment!.to.length}/${
              this._activeAssignment!.to.length
            } recipients failed, could not send email.`
          )
        );
      }
    }

    // Checks if there is another recipient to send, if so trigger that.
    if (index + 1 < this._activeAssignment!.to.length) {
      this._transactionSendRcptTo(++index);
      return;
    }

    // We only do data in this fashion, it's faster for us.
    this._transactionSendData();
  }

  /**
   * Sends the data command.
   * @protected
   */
  protected _transactionSendData(): void {
    this._logger?.debug(`Sending data command ...`);
    this._smtpClient.sendDATACommand(
      (command: SmtpCommand, response: SmtpResponse) =>
        this._transactionHandleDataResponse(command, response)
    );
  }

  /**
   * Handles the data response.
   * @param command the command we sent.
   * @param response the response.
   * @protected
   */
  protected _transactionHandleDataResponse(
    command: SmtpCommand,
    response: SmtpResponse
  ): void {
    this._logger?.debug(
      "Received data command, started streaming out data ..."
    );

    // Makes sure the response status indicates the success of the command.
    if (response.status !== 354) {
      this._giveUp(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Expected Status-Code: 354`
        )
      );
      return;
    }
    // Sets the response handler for after the data command.
    this._smtpClient.once("response", (response: SmtpResponse) =>
      this._transactionHandleDataCompletion(response)
    );

    // Creates the dot escape stream (escapes dots in the SMTP message).
    const escapeEncoder: DotEscapeEncodeStream = new DotEscapeEncodeStream({
      buffer_output: true,
    });

    // Handles the data end event of the dot encoder.
    escapeEncoder.on("data", (chunk: Buffer) =>
      this._smtpClient.smtpSocket.socket!.write(chunk)
    );
    escapeEncoder.on("end", () => {
      this._smtpClient.smtpSocket.write(".\r\n");
    });

    // Checks the type of assignment, and starts the transmission
    //  of the body.
    if (
      this._activeAssignment! instanceof SmtpClientCommanderBufferAssignment
    ) {
      const bufferStream: Readable = Readable.from(
        this._activeAssignment!.buffer
      );
      bufferStream.pipe(escapeEncoder);
    } else if (
      this._activeAssignment! instanceof SmtpClientCommanderStreamAssignment
    ) {
      this._activeAssignment!.stream.pipe(escapeEncoder);
    } else {
      throw new Error("Invalid kind of assignment supplied!");
    }
  }

  /**
   * Gets called when the data has been sent.
   * @param response the response.
   * @protected
   */
  protected _transactionHandleDataCompletion(response: SmtpResponse): void {
    this._logger?.debug("Received data complete response.");

    if (response.status !== 250) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          null,
          response,
          `Expected Status-Code: 250`
        )
      );
    }

    // Calls the handle done, and maybe starts the transmission of another message.
    this._handleDone(false);
  }

  ////////////////////////////////////////////////
  // Pre-Transaction Handlers.
  ////////////////////////////////////////////////

  /**
   * Handles the STARTTLS upgrade.
   * @protected
   */
  protected _handleStartTLSUpgraded() {
    this._logger?.debug("Connection is now upgraded, sending new EHLO ...");
    this._smtpClient.sendEHLOCommand(
      this._serverDomain,
      (command: SmtpCommand, response: SmtpResponse) =>
        this._handleEhloResponse(command, response)
    );
  }

  /**
   * Handles the STARTTLS response.
   * @param command the command we sent.
   * @param response the response to it.
   * @protected
   */
  protected _handleStartTLSResponse(
    command: SmtpCommand,
    response: SmtpResponse
  ) {
    this._logger?.debug("STARTTLS Response received, upgrading connection ...");

    if (response.status !== 220) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Expected Status-Code: 220`
        )
      );
    }

    this._smtpClient.once("upgrade", () => this._handleStartTLSUpgraded());
    this._smtpClient.upgrade();
  }

  /**
   * handles the EHLO response.
   * @param command the command we sent.
   * @param response the response.
   * @protected
   */
  protected _handleEhloResponse(command: SmtpCommand, response: SmtpResponse) {
    // Logs that we've received the EHLO, if debug enabled.
    this._logger?.debug("Received EHLO, checking capabilities ...");

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 250) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Expected Status-Code: 250`
        )
      );
    }

    // Decodes the capabilities.
    const capabilities: SmtpCapability[] = SmtpCapability.decode_many(
      response.message as string[],
      1 /* Skip the initial line, there is nothing there. */
    );

    // Derives the server options from the capabilities, and logs
    //  them to the console if debug enabled.
    this._serverOptions =
      smtp_client_server_opts_from_capabilities(capabilities);
    this._logger?.debug(
      `Detected server size: ${
        this._serverOptions.max_message_size
      }, with detected features: ${smtp_commander_server_opts_flags_string(
        this._serverOptions
      )}`
    );

    // If we're not yet in a secure connection, check if the server supports STARTTLS, if so upgrade the connection.
    if (
      !this._smtpClient.smtpSocket.secure &&
      this._serverOptions.features.are_set(SmtpCommanderServerFeatures.StartTLS)
    ) {
      this._logger?.debug("Server supports STARTTLS Upgrading ...");
      this._smtpClient.sendSTARTTLSCommand(
        (command: SmtpCommand, response: SmtpResponse) =>
          this._handleStartTLSResponse(command, response)
      );
      return;
    }

    // Calls the handle done, since we either want to enter IDLE state,
    //  or start transmission.
    this._handleDone(true);
  }

  /**
   * Handles the response to the HELO command.
   * @param command the command we sent.
   * @param response the response.
   * @protected
   */
  protected _handleHeloResponse(command: SmtpCommand, response: SmtpResponse) {
    // Logs that we've received the HELO, if debug enabled.
    this._logger?.debug(
      "Received HELO (LMFAO this server sucks so fucking hard, just support ESMTP ;P)."
    );

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 250) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          command,
          response,
          `Expected Status-Code: 250`
        )
      );
    }

    // Calls the handle done, since we either want to enter IDLE state,
    //  or start transmission.
    this._handleDone(true);
  }

  /**
   * Gets called when the initial greeting is received.
   * @param response the response.
   * @protected
   */
  protected _handleGreeting(response: SmtpResponse) {
    // Logs that we've received the greeting, if debug enabled.
    this._logger?.debug(
      `Received greeting with message: '${response.message_string}'`
    );

    // If the status code is invalid, just give up the transaction.
    if (response.status !== 220) {
      return this._giveUp(
        new SmtpClientCommanderTransactionError(
          null,
          response,
          `Expected Status-Code: 220`
        )
      );
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
      this._smtpClient.sendEHLOCommand(
        this._serverDomain,
        (command: SmtpCommand, response: SmtpResponse) =>
          this._handleEhloResponse(command, response)
      );
    } else if (this._flags.are_set(SmtpCommanderFlag.IS_SMTP)) {
      this._logger?.debug("Server supports SMTP only, sending HELO ...");
      this._smtpClient.sendHELOCommand(
        this._serverDomain,
        (command: SmtpCommand, response: SmtpResponse) =>
          this._handleHeloResponse(command, response)
      );
    }
  }
}
