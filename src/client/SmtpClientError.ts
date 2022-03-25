import {SmtpCommand} from "../shared/SmtpCommand";
import {SmtpResponse} from "../shared/SmtpResponse";

export enum SmtpClientErrorOrigin {
    Stream,                 // An error occurred in the stream.
    GeneratorInitial,       // An error occurred in the initial generator.
    GeneratorSMTP,          // An error occurred in the SMTP generator.
    GeneratorESMTP,         // An error occurred in the ESMTP generator.
    GeneratorIDLE,          // An error occurred in the IDLE generator.
    Next,                   // An error occurred in the next function.
}

export class SmtpClientError {
    /**
     * Constructs a new SmtpClientError.
     * @param origin The origin of the error
     * @param message The message associated with it.
     */
    public constructor(public readonly origin: SmtpClientErrorOrigin,
                       public readonly message: string | null = null) {}
}

export class SmtpClientTransactionError extends SmtpClientError {
    /**
     * Constructs a new SmtpClientTransactionError.
     * @param origin The origin of the error
     * @param message The message associated with it.
     * @param response The server response.
     * @param command The client command.
     */
    public constructor (origin: SmtpClientErrorOrigin,
                        message: string | null = null,
                        public readonly response: SmtpResponse | null = null,
                        public readonly command: SmtpCommand | null = null) {
        super(origin, message);
    }
}

export class SmtpClientFatalTransactionError extends SmtpClientTransactionError {}
