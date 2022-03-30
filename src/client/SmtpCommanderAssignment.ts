import { Readable } from "stream";

export interface SmtpClientAssignment {
    // Data.
    from: string;
    to: string[];
    data: Buffer;
    // Callbacks.
    callback: (err: Error | null) => void;
}
