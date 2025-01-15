import { IAgentRuntime } from "@elizaos/core";
import { isAddress } from "viem";
import { z } from "zod";

export const neonevmEnvSchema = z.object({
    NEONEVM_ADDRESS: z
        .string()
        .min(1, "Neon EVM address is required")
        .refine((address) => isAddress(address, { strict: false }), {
            message: "Neon EVM address must be a valid address",
        }),
    NEONEVM_PRIVATE_KEY: z
        .string()
        .min(1, "Neon EVM private key is required")
        .refine((key) => /^[a-fA-F0-9]{64}$/.test(key), {
            message:
                "Neon EVM private key must be a 64-character hexadecimal string (32 bytes) without the '0x' prefix",
        }),
});

export type NeonEVMConfig = z.infer<typeof neonevmEnvSchema>;

export async function validateNeonEVMConfig(
    runtime: IAgentRuntime
): Promise<NeonEVMConfig> {
    try {
        const config = {
            NEONEVM_ADDRESS:
                runtime.getSetting("NEONEVM_ADDRESS") ||
                process.env.NEONEVM_ADDRESS,
            NEONEVM_PRIVATE_KEY:
                runtime.getSetting("NEONEVM_PRIVATE_KEY") ||
                process.env.NEONEVM_PRIVATE_KEY,
        };

        return neonevmEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Neon EVM configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
