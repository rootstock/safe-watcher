import { exec } from "child_process";
import type { Mock } from "jest-mock";

import { NETWORKS } from "../src/safe-hashes/constants.js";
import { parseResponse, SafeTxHashes } from "../src/safe-hashes/index.js";
import {
  expectedParsedSafeHashesResponse,
  expectedParsedSafeHashesResponseEmpty,
  expectedParsedSafeHashesResponseNoAdditionalFields,
  expectedParsedSafeHashesResponseWithMethodAndParameters,
  expectedParsedSafeHashesResponseWithoutMethodAndParameters,
  mockSafeAddressNoPrefix,
  mockSafeHashesResponse,
  mockSafeHashesResponseNoAdditionalFields,
  rskPrefix,
  safeHashesResponseWithMethodAndParameters,
  safeHashesResponseWithoutMethodAndParameters,
} from "./utils/config-utils.js";

type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

// Mock child_process.exec
jest.mock("child_process", () => ({
  exec: jest.fn(),
}));

describe("SafeTxHashes", () => {
  const mockNonce = 1;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should execute script with correct parameters", async () => {
    const mockStdout = "Success";
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        expect(cmd).toBe(
          `/app/safe-hashes.sh --network ${NETWORKS.rsk} --address ${mockSafeAddressNoPrefix} --nonce ${mockNonce}`,
        );
        (callback as ExecCallback)(null, mockStdout, "");
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );
    expect(result).toEqual({
      success: true,
      data: mockStdout,
    });
  });

  // Test the actual error handling path (lines 23-30)
  test("should handle script error gracefully with actual function", async () => {
    const mockError = new Error("Script execution failed");
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        // Simulate the actual error handling in the real function
        (callback as ExecCallback)(mockError, "", "");
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );

    expect(result).toEqual({
      success: false,
      error: "Error executing script: Script execution failed",
    });
  });

  test("should handle stderr output gracefully with actual function", async () => {
    const mockStderr = "Permission denied";
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        // Simulate the actual stderr handling in the real function
        (callback as ExecCallback)(null, "", mockStderr);
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );

    expect(result).toEqual({
      success: false,
      error: "Error executing script: Permission denied",
    });
  });

  test("should return success with stdout data", async () => {
    const mockStdout = "Transaction hash: 0x123456789";
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        (callback as ExecCallback)(null, mockStdout, "");
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );

    expect(result).toEqual({
      success: true,
      data: mockStdout,
    });
  });

  test("should support all network prefixes", async () => {
    const mockStdout = "Success";
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        (callback as ExecCallback)(null, mockStdout, "");
      },
    );

    for (const prefix of Object.keys(NETWORKS)) {
      const result = await SafeTxHashes(
        prefix,
        mockSafeAddressNoPrefix,
        mockNonce,
      );
      expect(result).toEqual({
        success: true,
        data: mockStdout,
      });
      expect(exec).toHaveBeenCalledWith(
        `/app/safe-hashes.sh --network ${NETWORKS[prefix]} --address ${mockSafeAddressNoPrefix} --nonce ${mockNonce}`,
        expect.any(Function),
      );
    }
  });

  // Test different error scenarios to ensure all code paths are covered
  test("should handle error with no message", async () => {
    const mockError = new Error("");
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        (callback as ExecCallback)(mockError, "", "");
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );

    expect(result).toEqual({
      success: false,
      error: "Error executing script: ",
    });
  });

  test("should handle empty stderr as success", async () => {
    const mockStdout = "";
    const mockStderr = "";
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        (callback as ExecCallback)(null, mockStdout, mockStderr);
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );

    expect(result).toEqual({
      success: true,
      data: mockStdout,
    });
  });

  test("should handle non-empty stderr as error", async () => {
    const mockStderr = "Script execution warning";
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, callback: unknown) => {
        (callback as ExecCallback)(null, "", mockStderr);
      },
    );

    const result = await SafeTxHashes(
      rskPrefix,
      mockSafeAddressNoPrefix,
      mockNonce,
    );

    expect(result).toEqual({
      success: false,
      error: "Error executing script: Script execution warning",
    });
  });
});

describe("parseResponse", () => {
  test("should parse valid response", () => {
    const result = parseResponse(mockSafeHashesResponse);
    expect(result).toEqual(expectedParsedSafeHashesResponse);
  });

  test("should handle missing optional fields", () => {
    const result = parseResponse(mockSafeHashesResponseNoAdditionalFields);
    expect(result).toEqual(expectedParsedSafeHashesResponseNoAdditionalFields);
  });

  test("should handle empty response", () => {
    const result = parseResponse("");
    expect(result).toEqual(expectedParsedSafeHashesResponseEmpty);
  });

  test("should handle malformed response", () => {
    const mockResponse = `
Invalid line
Another invalid line
`;

    const result = parseResponse(mockResponse);
    expect(result).toEqual(expectedParsedSafeHashesResponseEmpty);
  });

  test("should handle invalid numeric value in response", () => {
    const mockResponse = `
Multisig address: 0x1234567890123456789012345678901234567890
To: 0xabcdef1234567890abcdef1234567890abcdef12
Value: not-a-number
Data: 0x1234567890abcdef
Encoded message: 0xabcdef1234567890
Legacy Ledger Format
Binary string literal: 0x1234567890abcdef
Domain hash: 0xabcdef1234567890
Message hash: 0x1234567890abcdef
Safe transaction hash: 0xabcdef1234567890
`;

    const result = parseResponse(mockResponse);
    expect(result.transactionData.value).toBe(0);
    expect(result.transactionData.multisigAddress).toBe(
      "0x1234567890123456789012345678901234567890",
    );
  });
});

describe("parseResponse (realistic scenarios)", () => {
  test("Parse with method and parameters (realistic)", () => {
    const response = parseResponse(safeHashesResponseWithMethodAndParameters);
    expect(response).toStrictEqual(
      expectedParsedSafeHashesResponseWithMethodAndParameters,
    );
  });

  test("Parse without method and parameters (realistic)", () => {
    const response = parseResponse(
      safeHashesResponseWithoutMethodAndParameters,
    );
    expect(response).toStrictEqual(
      expectedParsedSafeHashesResponseWithoutMethodAndParameters,
    );
  });
});
