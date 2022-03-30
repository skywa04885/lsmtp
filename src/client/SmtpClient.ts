import { SmtpResponse } from "../shared/SmtpResponse";
import { EventEmitter } from "events";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { SmtpSocket } from "../shared/SmtpSocket";

export enum SmtpClientFlag {
  IS_ESMTP = 1 << 0, // The server is an ESMTP server.
  IS_SMTP = 1 << 1, // The server is an SMTP server.
  SUPPORTS_STARTTLS = 1 << 2, // If the server supports STARTTLS
}

export interface SmtpClientOptions {}

export declare interface SmtpClient {
  on(event: "response", listener: (response: SmtpResponse) => void): this;
}

export class SmtpClient extends EventEmitter {
  protected _smtp_socket?: SmtpSocket;

  public constructor() {
    super();
  }

  protected assert_socket(): void {
    if (!this._smtp_socket) {
      throw new Error("The client has no valid SMTP Socket.");
    }
  }

  public cmd(command: SmtpCommand) {
    this.assert_socket();

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
    this.cmd(new SmtpCommand(SmtpCommandType.Vrfy, [ `<${address}>` ]))
  }
  
  public cmd_vrfy_name(name: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Vrfy, [ name ]));
  }
  
  public cmd_expn(mailbox: string): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Expn, [ mailbox ]));
  }
  
  public cmd_noop(): void {
    this.cmd(new SmtpCommand(SmtpCommandType.Noop, null));
  }
}
