import { Readable } from "stream";
import { SmtpCommand } from "../shared/SmtpCommand";
import { SmtpResponse } from "../shared/SmtpResponse";

export class SmtpClientAssignmentError extends Error {}

export class SmtpClientAssignmentMailExchangeError extends SmtpClientAssignmentError {
  public constructor(public exchanges: string[], message?: string) {
    super(message);
  }
}

export class SmtpClientAssignmentNetworkingError extends SmtpClientAssignmentError {}

export class SmtpClientAssignmentTransactionError extends SmtpClientAssignmentError {
  public constructor(public response: SmtpResponse, message?: string) {
    super(message);
  }
}

export class SmtpClientAssignmentErrorRecipientError extends SmtpClientAssignmentError {
  public constructor(
    public recipient: string,
    public response: SmtpResponse,
    message?: string
  ) {
    super(message);
  }
}

export interface SmtpClientAssignmentResult {
  transfer_start?: Date;
  transfer_end?: Date;
  errors: SmtpClientAssignmentError[];
}

export interface SmtpClientCommanderAssignment {
  // Data.
  domain: string;
  from: string;
  to: string[];
  data: Buffer;
  // Callbacks.
  callback: (result: SmtpClientAssignmentResult) => void;
}
