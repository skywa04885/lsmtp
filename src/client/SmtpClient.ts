import { SmtpResponse } from "../shared/SmtpResponse";
import { EventEmitter } from "events";

export enum SmtpClientFlag {
    ESMTP = (1 << 0),                   // The server is an ESMTP server.
    SMTP = (1 << 1),                    // The server is an SMTP server.
}

export interface SmtpClientOptions {

}

export declare interface SmtpClient {
    on(event: 'response', listener: (response: SmtpResponse) => void): this;
}

export class SmtpClient extends EventEmitter {

}