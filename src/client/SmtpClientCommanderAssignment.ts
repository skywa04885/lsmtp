import {EmailAddress} from "llibemailaddress";
import {Readable} from "stream";
import {SmtpClientCommanderErrors} from "./SmtpClientCommanderErrors";

/////////////////////////////////////////////
// Commander Assignment Base
/////////////////////////////////////////////

export enum SmtpClientCommanderAssignmentState {
  Enqueued,
  Executing,
  Executed,
}

export class SmtpClientCommanderAssignment {
  /**
   * Constructs a new commander assignment.
   * @param domain the domain to send to.
   * @param from the from address.
   * @param to the to address array.
   * @param cb the callback to be called when done.
   * @protected
   */
  protected constructor(
    public readonly domain: string,
    public readonly from: EmailAddress,
    public readonly to: EmailAddress[],
    public readonly cb: (() => void) | null = null
  ) {
    this._state = SmtpClientCommanderAssignmentState.Enqueued;

    // Default stuff.
    this._transactionStartDate = null;
    this._transactionEndDate = null;
    this._errors = new SmtpClientCommanderErrors();
  }

  protected _state: SmtpClientCommanderAssignmentState;

  /**
   * Gets the state.
   */
  public get state(): SmtpClientCommanderAssignmentState {
    return this._state;
  }

  protected _transactionStartDate: Date | null;

  /**
   * Gets the start date.
   */
  public get transactionStartDate(): Date {
    if (!this._transactionStartDate) {
      throw new Error("Start date is not available yet.");
    }

    return this._transactionStartDate;
  }

  protected _transactionEndDate: Date | null;

  /**
   * Gets the end date.
   */
  public get transactionEndDate(): Date {
    if (!this._transactionEndDate) {
      throw new Error("End date is not available yet.");
    }

    return this._transactionEndDate;
  }

  protected _errors: SmtpClientCommanderErrors;

  /**
   * Gets the errors class.
   */
  public get errors(): SmtpClientCommanderErrors {
    return this._errors;
  }

  /**
   * Gets called when we start executing the assignment.
   */
  public setExecuting(): void {
    if (this._state !== SmtpClientCommanderAssignmentState.Enqueued) {
      throw new Error(`Cannot set executing in state: ${this._state}`);
    }

    this._transactionStartDate = new Date();
    this._state = SmtpClientCommanderAssignmentState.Executing;
  }

  /**
   * Gets called when the assignment has been executed.
   */
  public setExecuted(): void {
    if (this._state !== SmtpClientCommanderAssignmentState.Executed) {
      throw new Error(`Cannot set executed in state: ${this._state}`);
    }

    this._transactionEndDate = new Date();
    this._state = SmtpClientCommanderAssignmentState.Executed;
  }
}

/////////////////////////////////////////////
// Commander Buffer Assignment
/////////////////////////////////////////////

export class SmtpClientCommanderBufferAssignment extends SmtpClientCommanderAssignment {
  /**
   * Constructs a new commander assignment.
   * @param buffer the buffer to send.
   * @param domain the domain to send to.
   * @param from the from address.
   * @param to the to address array.
   * @param cb the callback to be called when done.
   */
  public constructor(
    public readonly buffer: Buffer,
    domain: string,
    from: EmailAddress,
    to: EmailAddress[],
    cb: (() => void) | null = null
  ) {
    super(domain, from, to, cb);
  }
}

/////////////////////////////////////////////
// Commander Stream Assignment
/////////////////////////////////////////////

export class SmtpClientCommanderStreamAssignment extends SmtpClientCommanderAssignment {
  /**
   * Constructs a new commander assignment.
   * @param stream the stream to pipe.
   * @param domain the domain to send to.
   * @param from the from address.
   * @param to the to address array.
   * @param cb the callback to be called when done.
   */
  public constructor(
    public readonly stream: Readable,
    domain: string,
    from: EmailAddress,
    to: EmailAddress[],
    cb: (() => void) | null = null
  ) {
    super(domain, from, to, cb);
  }
}
