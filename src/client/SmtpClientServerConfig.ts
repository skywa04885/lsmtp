import {Flags} from "../helpers/Flags";
import { SmtpServerFeatureFlag } from "../server/SmtpServerConfig";
import {SmtpCapability, SmtpCapabilityType} from "../shared/SmtpCapability";
import {SmtpClientErrorOrigin, SmtpClientFatalTransactionError} from "./SmtpClientError";

export enum SmtpCommanderServerFeatures {
    Pipelining = (1 << 0),
    StartTLS = (1 << 1),
    EightBitMime = (1 << 2),
    SMTP_UTF8 = (1 << 3),
    Authentication = (1 << 4),
    Verification = (1 << 5),
    Chunking = (1 << 6),
    Expand = (1 << 7),
}

export interface SmtpCommanderServerOpts {
    max_message_size: number | null;
    features: Flags;
}

export function smtp_commander_server_opts_flags_string(opts: SmtpCommanderServerOpts) {
    let arr: string[] = [];

    for (const [key, value] of Object.entries(SmtpCommanderServerFeatures)) {
        if (opts.features.are_set(value as number)) {
            arr.push(key);
        }
    }

    return arr.join(', ');
}

export function smtp_client_server_opts_from_capabilities(capabilities: SmtpCapability[]): SmtpCommanderServerOpts {
    let result: SmtpCommanderServerOpts = {
        max_message_size: null,
        features: new Flags(),
    };

    // Loops over the capabilities, and updates the server options.
    capabilities.forEach((capability: SmtpCapability): void => {
        switch (capability.type) {
            case SmtpCapabilityType.Auth:
                result.features.set(SmtpCommanderServerFeatures.Authentication);
                break;
            case SmtpCapabilityType.Chunking:
                result.features.set(SmtpCommanderServerFeatures.Chunking);
                break;
            case SmtpCapabilityType.Vrfy:
                result.features.set(SmtpCommanderServerFeatures.Verification);
                break;
            case SmtpCapabilityType.Expn:
                result.features.set(SmtpCommanderServerFeatures.Expand);
                break;
            case SmtpCapabilityType.EightBitMIME:
                result.features.set(SmtpCommanderServerFeatures.EightBitMime);
                break;
            case SmtpCapabilityType.SmtpUTF8:
                result.features.set(SmtpCommanderServerFeatures.SMTP_UTF8);
                break;
            case SmtpCapabilityType.Pipelining:
                result.features.set(SmtpCommanderServerFeatures.Pipelining);
                break;
            case SmtpCapabilityType.StartTLS:
                result.features.set(SmtpCommanderServerFeatures.StartTLS);
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