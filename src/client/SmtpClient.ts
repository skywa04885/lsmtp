import { SmtpResponse } from "../shared/SmtpResponse";
import { EventEmitter } from "events";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpClientDNS } from "./SmtpClientDNS";
import { SmtpClientStream } from "./SmtpClientStream";
import { SmtpStream } from "../server/SmtpServerStream";
import { Logger } from "../helpers/Logger";

export interface SmtpClientOptions {
  debug?: boolean;
}

export declare interface SmtpClient {
  once(event: "upgrade", listener: () => void): this;
  on(event: "upgrade", listener: () => void): this;
  once(event: "response", listener: (response: SmtpResponse) => void): this;
  on(event: "response", listener: (response: SmtpResponse) => void): this;
}

export class SmtpClient extends EventEmitter {
  protected _debug: boolean;

  protected _smtp_socket: SmtpSocket;
  protected _smtp_stream: SmtpClientStream;
  protected _logger?: Logger;

  public constructor(options: SmtpClientOptions = {}) {
    super();

    // Sets the options.
    this._debug = options.debug ?? false;

    // Creates the logger if needed.
    if (this._debug) {
      this._logger = new Logger('SmtpClient');
    }

    // Creates the instance variables.
    this._smtp_socket = new SmtpSocket(false);
    this._smtp_stream = new SmtpClientStream();
    
    // Registers the standard event listeners (for the socket).
    this._smtp_socket.on('connect', () => this._handle_connect());
    this._smtp_socket.on('upgrade', () => this._handle_upgrade());
    this._smtp_socket.on('data', (chunk: Buffer) => this._smtp_stream.write(chunk));
    this._smtp_socket.on('close', () => this._handle_close());

    // Registers the standard event listener (for the stream).
    this._smtp_stream.on('response', (response: SmtpResponse) => this._handle_response(response));
  }

  ////////////////////////////////////////////////
  // Getters
  ////////////////////////////////////////////////

  public get socket(): SmtpSocket {
    return this._smtp_socket;
  }

  ////////////////////////////////////////////////
  // Protected Static Methods
  ////////////////////////////////////////////////

  protected static async _get_mx_exchanges(hostname: string): Promise<string[]> {
    return await SmtpClientDNS.mx(hostname);
  }

  ////////////////////////////////////////////////
  // Instance Methods
  ////////////////////////////////////////////////

  /**
   * Connects the SmtpClient to the given server.
   * @param hostname the hostname.
   * @param port the port.
   * @param secure if we're using a secure socket.
   * @param use_mx if we should solve for mx.
   */
  public async connect(hostname: string, port: number, secure: boolean, use_mx: boolean): Promise<void> {
    let exchange: string;

    // Checks if we're using MX, if so resolve the MX records, else just set
    //  the hostname as the exchange.
    if (use_mx) {
      // Prints that we're solving for MX records.
      if (this._debug) {
        this._logger!.trace(`Resolving MX records for hostname: ${hostname}`);
      }

      // Gets the exchanges.
      const exchanges: string[] = await SmtpClient._get_mx_exchanges(hostname);
      if (exchanges.length === 0) {
        throw new Error('Could not find any exchange from MX records.');
      }

      // Uses the first exchange (highest rank).
      exchange = exchanges[0];
    } else {
      exchange = hostname;
    }

    // Prints which exchange we're using.
    if (this._debug) {
      this._logger!.trace(`Using mail exchange ${exchange}:${port}`);
    }

    // Connects the client.
    this._smtp_socket.connect(secure, exchange, port);
  }

  public upgrade(): void {
    this._smtp_socket.upgrade();
  }

  public cmd(command: SmtpCommand) {
    const command_encoded: string = command.encode(true);
    this._smtp_socket!.write(command_encoded);
  }

  public cmd_ehlo(server_domain: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Ehlo, [server_domain]));
  }

  public cmd_helo(server_domain: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Helo, [server_domain]));
  }

  public cmd_rset(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Rset, null));
  }

  public cmd_start_tls(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.StartTLS, null));
  }

  public cmd_mail_from(from: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Mail, [`FROM:<${from}>`]));
  }

  public cmd_rcpt_to(to: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Rcpt, [`TO:<${to}>`]));
  }

  public cmd_bdat(size: number, last: boolean = false): void {
    let parameters: string[] = [];

    parameters.push(size.toString());

    if (last) {
      parameters.push("LAST");
    }

    this.cmd(new SmtpCommand(SmtpCommandType.Bdat, parameters));
  }

  public cmd_data(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Data, null));
  }

  public cmd_help(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Help, null));
  }

  public cmd_quit(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Quit, null));
  }

  public cmd_vrfy_address(address: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Vrfy, [`<${address}>`]))
  }

  public cmd_vrfy_name(name: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Vrfy, [name]));
  }

  public cmd_expn(mailbox: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Expn, [mailbox]));
  }

  public cmd_noop(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Noop, null));
  }

  ////////////////////////////////////////////////
  // Event Listeners
  ////////////////////////////////////////////////

  protected _handle_response(response: SmtpResponse): void {
    if (this._debug) {
      this._logger!.trace('Response event triggered.');
    }
    
    this.emit('response', response);
  }

  /**
   * Gets called when we've connected.
   */
  protected _handle_connect() {
    if (this._debug) {
      this._logger!.trace('Connect event triggered.');
    }

    this.emit('connect');
  }

  /**
   * Gets called when we've upgraded the connection.
   */
  protected _handle_upgrade() {
    if (this._debug) {
      this._logger!.trace('Upgrade event triggered.');
    }

    this.emit('upgrade');
  }

  /**
   * Gets called when we've closed the connection.
   */
  protected _handle_close() {
    if (this._debug) {
      this._logger!.trace('Close event triggered.');
    }

    this.emit('close');
  }
}
