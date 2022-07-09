import { SmtpResponse } from "../shared/SmtpResponse";
import { EventEmitter } from "events";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpClientStream } from "./SmtpClientStream";
import winston from "winston";
import { EmailAddress } from "llibemailaddress";

export type SendCommandAddResponseListenerType = (
  command: SmtpCommand,
  response: SmtpResponse
) => void;

export interface SmtpClientOptions {}

export declare interface SmtpClient {
  once(event: "upgrade", listener: () => void): this;

  on(event: "upgrade", listener: () => void): this;

  once(event: "response", listener: (response: SmtpResponse) => void): this;

  on(event: "response", listener: (response: SmtpResponse) => void): this;

  once(event: "close", listener: () => void): this;

  on(event: "error", listener: (error: Error) => void): this;

  once(event: "error", listener: (error: Error) => void): this;
}

export class SmtpClient extends EventEmitter {
  protected _smtpStream: SmtpClientStream;
  protected _logger?: winston.Logger;

  /**
   * Constructs a new SMTP Client.
   * @param options the options.
   * @param logger the logger.
   */
  public constructor(options: SmtpClientOptions = {}, logger?: winston.Logger) {
    super();

    // Sets the logger.
    this._logger = logger;

    // Creates the instance variables.
    this._smtpSocket = new SmtpSocket(false);
    this._smtpStream = new SmtpClientStream();

    // Registers the standard event listeners (for the socket).
    this._smtpSocket.on("connect", () => this._handleConnect());
    this._smtpSocket.on("upgrade", () => this._handleUpgrade());
    this._smtpSocket.on("error", (error: Error) => this._handleError(error));
    this._smtpSocket.on("data", (chunk: Buffer) =>
      this._smtpStream.write(chunk)
    );
    this._smtpSocket.on("close", () => this._handleClose());

    // Registers the standard event listener (for the stream).
    this._smtpStream.on("response", (response: SmtpResponse) =>
      this._handleResponse(response)
    );
  }

  protected _smtpSocket: SmtpSocket;

  ////////////////////////////////////////////////
  // Getters
  ////////////////////////////////////////////////

  /**
   * Gets the SMTP Socket.
   */
  public get smtpSocket(): SmtpSocket {
    return this._smtpSocket;
  }

  ////////////////////////////////////////////////
  // Instance Methods
  ////////////////////////////////////////////////

  /**
   * Connects the SmtpClient to the given server.
   * @param exchange the exchange.
   * @param port the port.
   * @param secure if we're using a secure socket.
   */
  public connect(exchange: string, port: number, secure: boolean): void {
    this._smtpSocket.connect(secure, exchange, port);
  }

  /**
   * Upgrades the client to TLS.
   */
  public upgrade(): void {
    this._smtpSocket.upgrade();
  }

  /**
   * Sends the given command.
   * @param command the command to send.
   */
  public sendCommand(command: SmtpCommand) {
    this._logger?.info(`>> ${command.encode(false)}`);

    const command_encoded: string = command.encode(true);
    this._smtpSocket!.write(command_encoded);
  }

  /**
   * Sends the Extended Greet command.
   * @param serverHostname the server's hostname.
   * @param listener the response listener.
   */
  public sendEHLOCommand(
    serverHostname: string,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Ehlo, [
      serverHostname,
    ]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the Greet command.
   * @param serverHostname the server's hostname.
   * @param listener the response listener.
   */
  public sendHELOCommand(
    serverHostname: string,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Helo, [
      serverHostname,
    ]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the RSET Command.
   * @param listener the response listener.
   */
  public sendRSETCommand(
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Rset, null);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the STARTTLS command.
   * @param listener the response listener.
   */
  public sendSTARTTLSCommand(
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(
      SmtpCommandType.StartTLS,
      null
    );

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the MAIL FROM command.
   * @param from the source email address.
   * @param listener the response listener.
   */
  public sendMAILFROMCommand(
    from: EmailAddress,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Mail, [
      `FROM:<${from.address}>`,
    ]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the RCPT TO Command.
   * @param to the destination email address.
   * @param listener the response listener.
   */
  public sendRCPTTOCommand(
    to: EmailAddress,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Rcpt, [
      `TO:<${to.address}>`,
    ]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the BDAT command.
   * @param size the chunk size.
   * @param last if it's the last chunk.
   * @param listener the response listener.
   */
  public sendBDATCommand(
    size: number,
    last: boolean = false,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    let parameters: string[] = [];

    // Pushes the size of the chunk.
    parameters.push(size.toString());

    // Adds the 'LAST' keyword, if this is the last one.
    if (last) {
      parameters.push("LAST");
    }

    // Constructs the command.
    const command: SmtpCommand = new SmtpCommand(
      SmtpCommandType.Bdat,
      parameters
    );

    // Adds the listener if there.
    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    // Sends the command.
    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the DATA command.
   * @param listener the response listener.
   */
  public sendDATACommand(
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Data, null);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the HELP command.
   * @param listener the response listener.
   */
  public sendHELPCommand(
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Help, null);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the QUIT command.
   * @param listener the response listener.
   */
  public sendQUITCommand(
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Quit, null);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the VRFY command for address.
   * @param email
   * @param listener the response listener.
   */
  public sendVRFYAddressCommand(
    email: EmailAddress,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Vrfy, [
      `<${email.address}>`,
    ]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the VRFY command for name.
   * @param name
   * @param listener the response listener.
   */
  public sendVRFYNameCommand(
    name: string,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Vrfy, [name]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the EXPN Command.
   * @param mailbox
   * @param listener the response listener.
   */
  public sendEXPNCommand(
    mailbox: string,
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Expn, [
      mailbox,
    ]);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Sends the NOOP Command.
   * @param listener the response listener.
   */
  public sendNOOPCommand(
    listener: SendCommandAddResponseListenerType | null = null
  ): SmtpCommand {
    const command: SmtpCommand = new SmtpCommand(SmtpCommandType.Noop, null);

    if (listener !== null) {
      this._sendCommandAddResponseListener(command, listener);
    }

    this.sendCommand(command);
    return command;
  }

  /**
   * Adds a response listener.
   * @param command sent command.
   * @param listener the listener.
   * @protected
   */
  protected _sendCommandAddResponseListener(
    command: SmtpCommand,
    listener: SendCommandAddResponseListenerType
  ) {
    this.once("response", (response: SmtpResponse): void => {
      listener(command, response);
    });
  }

  ////////////////////////////////////////////////
  // Event Listeners
  ////////////////////////////////////////////////

  /**
   * handles an SMTP response.
   * @param response the response.
   * @protected
   */
  protected _handleResponse(response: SmtpResponse): void {
    this._logger?.info(`<< ${response.encode(false)}`);

    this.emit("response", response);
  }

  /**
   * Gets called when we've connected.
   * @protected
   */
  protected _handleConnect() {
    this._logger?.debug("Connect event triggered.");

    this.emit("connect");
  }

  /**
   * Gets called when we've upgraded the connection.
   * @protected
   */
  protected _handleUpgrade() {
    this._logger?.debug("Upgrade event triggered.");

    this.emit("upgrade");
  }

  /**
   * Gets called when we've closed the connection.
   * @protected
   */
  protected _handleClose() {
    this._logger?.debug("Close event triggered.");

    this.emit("close");
  }

  /**
   * Gets called when an error has occured.
   * @param error the error.
   * @protected
   */
  protected _handleError(error: Error) {
    this.emit("error", error);
  }
}
