import { LINE_SEPARATOR, SEGMENT_SEPARATOR } from "./SmtpConstants";
import { SmtpInvalidCommandError } from "./SmtpError";

export enum SmtpCommandType {
  Helo = "HELO",
  Ehlo = "EHLO",
  Mail = "MAIL",
  Rcpt = "RCPT",
  Data = "DATA",
  Rset = "RSET",
  Vrfy = "VRFY",
  Expn = "EXPN",
  Help = "HELP",
  Noop = "NOOP",
  Quit = "QUIT",
  Bdat = "BDAT",
  Turn = "TURN",
  Saml = "SAML",
  Soml = "SOML",
  Auth = "AUTH",
  Send = "SEND",
  XClient = "XCLIENT",
  XForward = "XFORWARD",
  StartTLS = "STARTTLS",
}

export enum SmtpMailPrefix {
  From = 'FROM',
}

export enum SmtpRcptPrefix {
  To = 'TO',
}

export class SmtpCommand {
  protected splitted_cache: string[] | null;

  public constructor(
    public readonly type: SmtpCommandType,
    public readonly args: string | string[] | null
  ) {
    this.splitted_cache = null;
  }

  /**
   * Gets the arguments array.
   */
  public get arguments(): string[] | null {
    if (this.args === null) {
      return null;
    }

    if (typeof this.args === "string") {
      if (!this.splitted_cache) {
        this.splitted_cache = this.args.split(SEGMENT_SEPARATOR);
      }

      return this.splitted_cache;
    }

    return this.args;
  }

  /**
   * Gets the argument as string.
   */
  public get argument(): string | null {
    return this.args as string | null;
  }

  public encode(add_newline: boolean = false): string {
    let arr: string[] = [];

    arr.push(this.type);

    if (this.args !== null) {
      if (typeof this.args === "string") {
        arr.push(this.args.trim());
      } else {
        this.args?.forEach((arg: string): void => {
          arr.push(arg.trim());
        });
      }
    }

    let result: string = arr.join(SEGMENT_SEPARATOR);
    if (add_newline) {
      result += LINE_SEPARATOR;
    }

    return result;
  }

  /**
   * Parses the given command.
   * @param raw the raw command.
   * @returns the parsed command.
   */
  public static decode(raw: string): SmtpCommand {
    raw = raw.trim();

    const split_index: number = raw.indexOf(SEGMENT_SEPARATOR);

    let raw_type: string | null = null;
    let raw_args: string | null = null;

    if (split_index === -1) {
      raw_type = raw.toUpperCase();
    } else {
      raw_type = raw.substring(0, split_index).trim().toUpperCase();
      raw_args = raw.substring(split_index + 1).trim();
    }

    if (!Object.values(SmtpCommandType).includes(raw_type as SmtpCommandType)) {
      throw new SmtpInvalidCommandError("Invalid command type.");
    }

    return new SmtpCommand(raw_type as SmtpCommandType, raw_args);
  }
}
