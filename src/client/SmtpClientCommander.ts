import EventEmitter from "events";
import { Flags } from "../helpers/Flags";
import { Logger } from "../helpers/Logger";
import { SmtpCapability } from "../shared/SmtpCapability";
import { SmtpResponse } from "../shared/SmtpResponse";
import { SmtpClient, SmtpClientOptions } from "./SmtpClient";
import { SmtpCommanderServerFeatures, SmtpCommanderServerOpts, smtp_client_server_opts_from_capabilities, smtp_commander_server_opts_flags_string } from "./SmtpClientServerConfig";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";

export enum SmtpCommanderFlag {
  IS_ESMTP = 1 << 0, // The server is an ESMTP server.
  IS_SMTP = 1 << 1, // The server is an SMTP server.
  SUPPORTS_STARTTLS = 1 << 2, // If the server supports STARTTLS
}

export declare interface SmtpClientCommander {
  on(event: 'destroy', listener: () => void): this;
  on(event: 'ready', listener: () => void): this;
}

export interface SmtpCLientCommanderOptions {
  server_domain?: string;
  debug?: boolean;
}

export class SmtpClientCommander extends EventEmitter {
  protected _server_domain: string;
  protected _debug: boolean;

  protected _smtp_client: SmtpClient;

  protected _logger?: Logger;

  protected _flags: Flags;
  protected _server_opts?: SmtpCommanderServerOpts;

  public constructor(smtp_client: SmtpClient, options: SmtpCLientCommanderOptions = {}) {
    super();

    // Sets the options.
    this._server_domain = options.server_domain ?? 'unset.local';
    this._debug = options.debug ?? false;

    // Creates the logger if debugging enabled.
    if (this._debug) {
      this._logger = new Logger('SmtpClientCommander');
    }

    // Assigns the SMTP client.
    this._smtp_client = smtp_client;

    // Sets the default variable values.
    this._flags = new Flags();

    // Registers the events.
    this._smtp_client.once('response', (response: SmtpResponse) => this._handle_greeting(response));
  }

  public assign(assignment: SmtpClientAssignment) {

  }

  ////////////////////////////////////////////////
  // General Handlers.
  ////////////////////////////////////////////////

  protected _handle_done() {

  }
  
  ////////////////////////////////////////////////
  // Transaction Handlers.
  ////////////////////////////////////////////////

  ////////////////////////////////////////////////
  // Pre-Transaction Handlers.
  ////////////////////////////////////////////////

  protected _handle_starttls_upgrade() {
    // Logs that we've upgraded the connection.
    if (this._debug) {
      this._logger!.trace('Connection is now upgraded, sending new EHLO ...');
    }

    // Writes the HELO command, to receive the new capabilities.
    this._smtp_client.once('response', (response: SmtpResponse) => this._handle_ehlo(response));
    this._smtp_client.cmd_ehlo(this._server_domain);
  }

  /**
   * Gets called when the starttls response is received.
   */
  protected _handle_starttls_response(response: SmtpResponse) {
    // Logs that we've received the STARTTLS response.
    if (this._debug) {
      this._logger!.trace('STARTTLS Response received, upgrading connection ...');
    }

    // Upgrades the connection.
    this._smtp_client.once('upgrade', () => this._handle_starttls_upgrade());
    this._smtp_client.upgrade();
  }

  /**
   * Gets called when the EHLO response has been returned.
   * @param response the response.
   */
  protected _handle_ehlo(response: SmtpResponse) {
    // Logs that we've received the EHLO, if debug enabled.
    if (this._debug) {
      this._logger!.trace('Received EHLO, checking capabilities ...');
    }

    // Decodes the capabilities.
    const capabilities: SmtpCapability[] = SmtpCapability.decode_many(
      response.message as string[], 1 /* Skip the initial line, there is nothing there. */);

    // Derives the server options from the capabilities, and logs
    //  them to the console if debug enabled.
    this._server_opts = smtp_client_server_opts_from_capabilities(capabilities);
    if (this._debug) {
      this._logger!.trace(`Detected server size: ${this._server_opts.max_message_size}, with detected features: ${smtp_commander_server_opts_flags_string(this._server_opts)}`)
    }

    // If we're not yet in a secure connection, check if the server supports STARTTLS, if so upgrade the connection.
    if (!this._smtp_client.socket.secure && this._server_opts.features.are_set(SmtpCommanderServerFeatures.StartTLS)) {
      if (this._debug) {
        this._logger!.trace('Server supports STARTTLS Upgrading ...');
      }

      this._smtp_client.once('response', (response: SmtpResponse) => this._handle_starttls_response(response));
      this._smtp_client.cmd_start_tls();

      return;
    }

    // Calls the handle done, since we either want to enter IDLE state,
    //  or start transmission.
    this._handle_done();
  }

  /**
   * Gets called when the HELO response has been returned.
   * @param response the response.
   */
  protected _handle_helo(response: SmtpResponse) {
    // Logs that we've received the HELO, if debug enabled.
    if (this._debug) {
      this._logger!.trace('Received HELO (LMFAO this server sucks so fucking hard, just support ESMTP ;P).');
    }

    // Calls the handle done, since we either want to enter IDLE state,
    //  or start transmission.
    this._handle_done();
  }

  /**
   * Gets called when the initial greeting is received.
   * @param response the response.
   */
  protected _handle_greeting(response: SmtpResponse) {
    // Logs that we've received the greeting, if debug enabled.
    if (this._debug) {
      this._logger!.trace(`Received greeting with message: '${response.message_string}'`);
    }

    // Gets the greeting message as a string.
    const message: string = response.message_string.toLocaleLowerCase();

    // Checks if the server is SMTP or ESMTP, and sets the flags accordingly.
    this._flags.set(message.includes('esmtp') ? SmtpCommanderFlag.IS_ESMTP : SmtpCommanderFlag.IS_SMTP);

    // Writes the HELO or EHLO message depending on the type of server, and sets the listener
    //  for the response.
    if (this._flags.are_set(SmtpCommanderFlag.IS_ESMTP)) {
      if (this._debug) {
        this._logger!.trace('Server supports ESMTP, sending EHLO ...');
      }

      this._smtp_client.once('response', (response: SmtpResponse) => this._handle_ehlo(response));
      this._smtp_client.cmd_ehlo(this._server_domain);
    } else if (this._flags.are_set(SmtpCommanderFlag.IS_SMTP)) {
      if (this._debug) {
        this._logger!.trace('Server supports SMTP only, sending HELO ...');
      }

      this._smtp_client.once('response', (response: SmtpResponse) => this._handle_helo(response));
      this._smtp_client.cmd_helo(this._server_domain);
    }
  }
}