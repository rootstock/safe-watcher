import { exec } from "child_process";
import type { Address } from "viem";

import logger from "../logger.js";
import { NETWORKS } from "./constants.js";
import type { SafeTxHashesResponse } from "./index.js";

export type Result<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export function SafeTxHashes(
  prefix: string,
  address: Address,
  nonce: number,
): Promise<Result<string>> {
  const network = NETWORKS[prefix];

  const executeWithRetry = (
    attempt: number = 1,
    maxRetries: number = 3,
  ): Promise<Result<string>> => {
    return new Promise<Result<string>>(resolve => {
      const timeout = 30000; // 30 seconds timeout

      const childProcess = exec(
        `~/app/safe-hashes.sh --network ${network} --address ${address} --nonce ${nonce}`,
        { timeout },
        (error, stdout, stderr) => {
          if (error) {
            logger.error(`error (attempt ${attempt}): ${error.message}`);

            // Check if the error is due to timeout (script waiting for input)
            if (error.signal === "SIGTERM" && error.code === null) {
              logger.warn(
                `Script execution timed out after ${timeout}ms - likely waiting for input (attempt ${attempt})`,
              );
              resolve({
                success: false,
                error: `Script execution timed out - script may be waiting for user input`,
              });
              return;
            }

            // Retry for error code 22 if we haven't exceeded max retries
            if (error.code === 22 && attempt < maxRetries) {
              logger.info(
                `Retrying due to error code 22... (attempt ${attempt + 1}/${maxRetries})`,
              );
              executeWithRetry(attempt + 1, maxRetries).then(resolve);
              return;
            }

            resolve({
              success: false,
              error: `Error executing script: ${error.message}`,
            });
            return;
          }
          if (stderr) {
            logger.error(`stderr: ${stderr}`);
            resolve({
              success: false,
              error: `Error executing script: ${stderr}`,
            });
            return;
          }
          logger.debug("stdout:", stdout);
          resolve({
            success: true,
            data: stdout,
          });
        },
      );

      // Additional timeout handling with explicit process kill
      const timeoutId = globalThis.setTimeout(() => {
        if (childProcess && !childProcess.killed) {
          logger.warn(
            `Force killing script process after ${timeout}ms timeout - script appears to be waiting for input (attempt ${attempt})`,
          );
          childProcess.kill("SIGTERM");

          // If SIGTERM doesn't work, use SIGKILL
          globalThis.setTimeout(() => {
            if (childProcess && !childProcess.killed) {
              logger.error(
                `Force killing script process with SIGKILL (attempt ${attempt})`,
              );
              childProcess.kill("SIGKILL");
            }
          }, 5000);
        }
      }, timeout);

      // Clear timeout if process completes normally
      childProcess.on("exit", () => {
        globalThis.clearTimeout(timeoutId);
      });
    });
  };

  return executeWithRetry();
}

export function parseResponse(response: string): SafeTxHashesResponse {
  const lines = response.split("\n");
  const extract = (key: string) =>
    lines.find(line => line.includes(key))?.split(": ")[1] || "";

  return {
    transactionData: {
      multisigAddress: extract("Multisig address") as Address,
      to: extract("To") as Address,
      value: (() => {
        const rawValue = extract("Value");
        const parsedValue = parseInt(rawValue, 10);
        if (isNaN(parsedValue)) {
          logger.warn(
            `Invalid numeric value extracted for "Value": ${rawValue}`,
          );
          return 0;
        }
        return parsedValue;
      })(),
      data: extract("Data: 0x") as `0x${string}`,
      encodedMessage: extract("Encoded message") as `0x${string}`,
      method: extract("Method") || null,
      parameters: extractParameters(lines),
    },
    legacyLedgerFormat: {
      binaryStringLiteral: extract("Binary string literal"),
    },
    hashes: {
      domainHash: extract("Domain hash") as `0x${string}`,
      messageHash: extract("Message hash") as `0x${string}`,
      safeTransactionHash: extract("Safe transaction hash") as `0x${string}`,
    },
  };
}

function extractParameters(lines: string[]): string | null {
  const start = lines.findIndex(line => line.includes("Parameters: [")) + 1;
  const end = lines.findIndex(
    line => line.includes("Legacy Ledger Format"),
    start,
  );
  return start > 0 && end > start
    ? lines.slice(start, end - 2).join("\n")
    : null;
}
