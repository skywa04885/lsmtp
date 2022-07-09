import {SmtpCommand} from "../shared/SmtpCommand";
import {SmtpResponse} from "../shared/SmtpResponse";

/////////////////////////////////////////////
// Base commander error
/////////////////////////////////////////////

export class SmtpClientCommanderError {
  public constructor(public readonly message: string | null = null) {}

  /**
   * Gets the label of the error.
   */
  get label(): string {
    return "General";
  }
}

/////////////////////////////////////////////
// Networking Error
/////////////////////////////////////////////

export enum SmtpClientCommanderNetworkingErrorOrigin {
  Other = "other",
  Connect = "connect",
  Upgrade = "upgrade",
  PrematureClosing = "premature-close",
}

export class SmtpClientCommanderNetworkingError extends SmtpClientCommanderError {
  /**
   * Constructs a new networking error.
   * @param origin the origin of the networking error.
   * @param message the message associated with it.
   */
  public constructor(
    public readonly origin: SmtpClientCommanderNetworkingErrorOrigin,
    message: string | null = null
  ) {
    super(message);
  }

  /**
   * Gets the label of the error.
   */
  get label(): string {
    return "Networking";
  }
}

/////////////////////////////////////////////
// Transaction Error
/////////////////////////////////////////////

export class SmtpClientCommanderTransactionError extends SmtpClientCommanderError {
  public constructor(
    public readonly command: SmtpCommand | null,
    public readonly response: SmtpResponse,
    message: string | null = null
  ) {
    super(message);
  }

  /**
   * Gets the label of the error.
   */
  get label(): string {
    return "Transaction";
  }
}

/////////////////////////////////////////////
// Error Container
/////////////////////////////////////////////

export class SmtpClientCommanderErrors {
  /**
   * Constructs a new smtp client commander error instance.
   * @param errors the errors.
   */
  public constructor(public readonly errors: SmtpClientCommanderError[] = []) {}

  /**
   * Gets the number of errors.
   */
  public get size(): number {
    return this.errors.length;
  }

  /**
   * Pushes a new error.
   * @param error the error to push.
   */
  public push(error: SmtpClientCommanderError): void {
    this.errors.push(error);
  }
}
