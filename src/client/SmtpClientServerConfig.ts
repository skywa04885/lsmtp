import {Flags} from "../helpers/Flags";
import {SmtpCapability, SmtpCapabilityType} from "../shared/SmtpCapability";
import {SmtpClientErrorOrigin, SmtpClientFatalTransactionError} from "./SmtpClientError";

export enum SmtpClientServerFeatures {
    Pipelining = (1 << 0),
    StartTLS = (1 << 1),
    EightBitMime = (1 << 2),
    SMTP_UTF8 = (1 << 3),
    Authentication = (1 << 4),
    Verification = (1 << 5),
    Chunking = (1 << 6),
    Expand = (1 << 7),
}

export interface SmtpClientServerOpts {
    max_message_size: number | null;
    features: Flags;
}

export function smtp_client_server_opts_from_capabilities(capabilities: SmtpCapability[]): SmtpClientServerOpts {
    let result: SmtpClientServerOpts = {
        max_message_size: null,
        features: new Flags(),
    };

    // Loops over the capabilities, and updates the server options.
    capabilities.forEach((capability: SmtpCapability): void => {
        switch (capability.type) {
            case SmtpCapabilityType.Auth:
                result.features.set(SmtpClientServerFeatures.Authentication);
                break;
            case SmtpCapabilityType.Chunking:
                result.features.set(SmtpClientServerFeatures.Chunking);
                break;
            case SmtpCapabilityType.Vrfy:
                result.features.set(SmtpClientServerFeatures.Verification);
                break;
            case SmtpCapabilityType.Expn:
                result.features.set(SmtpClientServerFeatures.Expand);
                break;
            case SmtpCapabilityType.EightBitMIME:
                result.features.set(SmtpClientServerFeatures.EightBitMime);
                break;
            case SmtpCapabilityType.SmtpUTF8:
                result.features.set(SmtpClientServerFeatures.SMTP_UTF8);
                break;
            case SmtpCapabilityType.Pipelining:
                result.features.set(SmtpClientServerFeatures.Pipelining);
                break;
            case SmtpCapabilityType.Size: {
                const args: string[] = capability.args as string[];
                if (args.length !== 1) {
                    throw new Error('Invalid SIZE capability.');
                }

                result.max_message_size = parseInt(args[0]);
                break;
            }
            default:
                break;
        }
    });

    // Returns the result.
    return result;
}