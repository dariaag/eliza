import type { Action } from "@elizaos/core";
import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    elizaLogger,
    composeContext,
    generateObject,
} from "@elizaos/core";
import { validateNeonEVMConfig } from "./enviroment";

import {
    Address,
    erc20Abi,
    http,
    isAddress,
    parseEther,
    parseUnits,
    createPublicClient,
} from "viem";
import { neonMainnet, neonDevnet } from "viem/chains";
import { normalize } from "viem/ens";
import { z } from "zod";
import { ValidateContext } from "../utils";
import { wSOL_ADDRESS, ERC20_OVERRIDE_INFO } from "../constants";
import { useGetAccount, useGetWalletClient } from "../hooks";
import { neonevmEnvSchema } from "./enviroment";

const wsolereumClient = createPublicClient({
    chain: neonMainnet,
    transport: http(),
});

const TransferActionSchema = z.object({
    tokenAddress: z.string(),
    recipient: z.string(),
    amount: z.string(),
});

export interface TransferContent extends Content {
    tokenAddress: string;
    recipient: string;
    amount: string | number;
}

const transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Here are several frequently used addresses. Use these for the corresponding tokens:
- NEOn/neon: 0x202C35e517Fa803B537565c40F0a6965D7204609
- wSOL/wsol: 0x5f38248f339Bf4e84A2caf4e4c0552862dC9F82a
- USDC/usdc: 0xEA6B04272f9f62F997F666F07D3a974134f7FFb9

Example response:
\`\`\`json
{
    "tokenAddress": "0x202C35e517Fa803B537565c40F0a6965D7204609",
    "recipient": "0xCCa8009f5e09F8C5dB63cb0031052F9CB635Af62",
    "amount": "1000"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token transfer:
- Token contract address
- Recipient wallet address
- Amount to transfer

Respond with a JSON markdown block containing only the extracted values.`;

export const TransferAction: Action = {
    name: "SEND_TOKEN",
    similes: [
        "TRANSFER_TOKEN_ON_NEONEVM",
        "TRANSFER_TOKEN_ON_NEON",
        "TRANSFER_TOKENS_ON_NEONEVM",
        "TRANSFER_TOKENS_ON_NEON",
        "SEND_TOKENS_ON_NEONEVM",
        "SEND_TOKENS_ON_NEON",
        "SEND_wSOL_ON_NEONEVM",
        "SEND_wSOL_ON_NEON",
        "PAY_ON_NEONEVM",
        "PAY_ON_NEON",
    ],
    validate: async (runtime: IAgentRuntime, _message: Memory) => {
        await validateNeonEVMConfig(runtime);
        return true;
    },
    description: "Transfer tokens from the agent's wallet to another address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting Neon EVM SEND_TOKEN handler...");

        // Initialize or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Compose transfer context
        const transferContext = composeContext({
            state,
            template: transferTemplate,
        });

        // Generate transfer content
        const content = (
            await generateObject({
                runtime,
                context: transferContext,
                modelClass: ModelClass.SMALL,
                schema: TransferActionSchema,
            })
        ).object as unknown as TransferContent;

        if (!isAddress(content.recipient, { strict: false })) {
            //ENS not supported yet
            elizaLogger.error("ENS not supported on Neon EVM yet");
            /*  elizaLogger.log("Resolving ENS name...");
            try {
                const name = normalize(content.recipient.trim());
                const resolvedAddress = await wsolereumClient.getEnsAddress({
                    name,
                });

                if (isAddress(resolvedAddress, { strict: false })) {
                    elizaLogger.log(`${name} resolved to ${resolvedAddress}`);
                    content.recipient = resolvedAddress;
                }
            } catch (error) {
                elizaLogger.error("Error resolving ENS name:", error);
            } */
        }

        // Validate transfer content
        if (!ValidateContext.transferAction(content)) {
            elizaLogger.error("Invalid content for TRANSFER_TOKEN action.");
            if (callback) {
                callback({
                    text: "Unable to process transfer request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }

        try {
            const account = useGetAccount(runtime);
            const walletClient = useGetWalletClient();

            let hash;

            // Check if the token is native
            if (
                content.tokenAddress.toLowerCase() !==
                wSOL_ADDRESS.toLowerCase()
            ) {
                // Convert amount to proper token decimals
                const tokenInfo =
                    ERC20_OVERRIDE_INFO[content.tokenAddress.toLowerCase()];
                const decimals = tokenInfo?.decimals ?? 18; // Default to 18 decimals if not specified
                const tokenAmount = parseUnits(
                    content.amount.toString(),
                    decimals
                );

                // Execute ERC20 transfer
                hash = await walletClient.writeContract({
                    account,
                    chain: neonMainnet,
                    address: content.tokenAddress as Address,
                    abi: erc20Abi,
                    functionName: "transfer",
                    args: [content.recipient as Address, tokenAmount],
                });
            } else {
                hash = await walletClient.sendTransaction({
                    account: account,
                    chain: neonMainnet,
                    to: content.recipient as Address,
                    value: parseEther(content.amount.toString()),
                    kzg: undefined,
                });
            }

            elizaLogger.success(
                "Transfer completed successfully! Transaction hash: " + hash
            );
            if (callback) {
                callback({
                    text:
                        "Transfer completed successfully! Transaction hash: " +
                        hash,
                    content: {},
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during token transfer:", error);
            if (callback) {
                callback({
                    text: `Error transferring tokens: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 0.01 wSOL to 0x114B242D931B47D5cDcEe7AF065856f70ee278C4",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Sure, I'll send 0.01 wSOL to that address now.",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Successfully sent 0.01 wSOL to 0x114B242D931B47D5cDcEe7AF065856f70ee278C4\nTransaction: 0xdde850f9257365fffffc11324726ebdcf5b90b01c6eec9b3e7ab3e81fde6f14b",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 0.01 wSOL to alim.getclave.wsol",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Sure, I'll send 0.01 wSOL to alim.getclave.wsol now.",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Successfully sent 0.01 wSOL to alim.getclave.wsol\nTransaction: 0xdde850f9257365fffffc11324726ebdcf5b90b01c6eec9b3e7ab3e81fde6f14b",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 100 USDC to alim.clv.wsol",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Sure, I'll send 100 USDC to alim.clv.wsol now.",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Successfully sent 100 USDC to alim.clv.wsol\nTransaction: 0xdde850f9257365fffffc11324726ebdcf5b90b01c6eec9b3e7ab3e81fde6f14b",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 100 USDC to 0xCCa8009f5e09F8C5dB63cb0031052F9CB635Af62",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Sure, I'll send 100 USDC to that address now.",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Successfully sent 100 USDC to 0xCCa8009f5e09F8C5dB63cb0031052F9CB635Af62\nTransaction: 0x4fed598033f0added272c3ddefd4d83a521634a738474400b27378db462a76ec",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Please send 100 ZK tokens to 0xbD8679cf79137042214fA4239b02F4022208EE82",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Of course. Sending 100 ZK to that address now.",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Successfully sent 100 ZK to 0xbD8679cf79137042214fA4239b02F4022208EE82\nTransaction: 0x0b9f23e69ea91ba98926744472717960cc7018d35bc3165bdba6ae41670da0f0",
                },
            },
        ],
    ] as ActionExample[][],
};
