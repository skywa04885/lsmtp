import { Readable } from "stream";
import { SmtpCommand } from "../shared/SmtpCommand";
import { SmtpResponse } from "../shared/SmtpResponse";

export enum SmtpClientAssignmentErrorType {
  MailExchange,
  SocketError,
  CommandError,
  RecipientUnreachable,
}

export interface SmtpClientAssignmentError {
  type: SmtpClientAssignmentErrorType;
}

export interface SmtpClientAssignmentError_MailExchange
  extends SmtpClientAssignmentError {
  exchanges: [{ exchange: string; priority: number; error: Error }];
}

export interface SmtpClientAssignmentError_SocketError
  extends SmtpClientAssignmentError {
  error: Error;
}

export interface SmtpClientAssignmentError_CommandError
  extends SmtpClientAssignmentError {
  response: SmtpResponse;
}

export interface SmtpClientAssignmentError_RecipientUnreachable
  extends SmtpClientAssignmentError_CommandError {
  recipient: string;
}

export interface SmtpClientAssignmentResult {
  transfer_start: Date;
  transfer_end: Date;
  errors: SmtpClientAssignmentError[];
}

export interface SmtpClientAssignment {
  // Data.
  domain: string;
  from: string;
  to: string[];
  data: Buffer;
  // Callbacks.
  callback: (result: SmtpClientAssignmentResult) => void;
}
