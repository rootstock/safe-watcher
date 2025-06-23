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

jest.useFakeTimers();

const TEST_CONSTANTS = {
  DEFAULT_NONCE: 1,
  LARGE_NONCE: 999999999999,
  SUCCESS_OUTPUT: "Success",
  TIMEOUT_ERROR_MESSAGE:
    "Script execution timed out - script may be waiting for user input",
  MAX_RETRIES: 3,
  RETRY_ERROR_CODE: 22,
} as const;

function createMockChildProcess() {
  return {
    on: jest.fn(),
    kill: jest.fn(),
    killed: false,
  };
}

function createMockError(
  message: string,
  code?: number | null,
  signal?: string,
) {
  const error = new Error(message) as any;
  if (code !== undefined) error.code = code;
  if (signal) error.signal = signal;
  return error;
}

function createSuccessExecMock(stdout: string = TEST_CONSTANTS.SUCCESS_OUTPUT) {
  return (cmd: unknown, options: unknown, callback: unknown) => {
    (callback as ExecCallback)(null, stdout, "");
    return createMockChildProcess();
  };
}

function createErrorExecMock(error: Error) {
  return (cmd: unknown, options: unknown, callback: unknown) => {
    (callback as ExecCallback)(error, "", "");
    return createMockChildProcess();
  };
}

function createStderrExecMock(stderr: string) {
  return (cmd: unknown, options: unknown, callback: unknown) => {
    (callback as ExecCallback)(null, "", stderr);
    return createMockChildProcess();
  };
}

function expectSuccessResult(result: any, data: string) {
  expect(result).toEqual({
    success: true,
    data,
  });
}

function expectErrorResult(result: any, error: string) {
  expect(result).toEqual({
    success: false,
    error,
  });
}

async function runSafeTxHashesTest(
  prefix: string = rskPrefix,
  address: `0x${string}` = mockSafeAddressNoPrefix,
  nonce: number = TEST_CONSTANTS.DEFAULT_NONCE,
) {
  return await SafeTxHashes(prefix, address, nonce);
}

describe("SafeTxHashes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  test("should execute script with correct parameters", async () => {
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, options: unknown, callback: unknown) => {
        expect(cmd).toBe(
          `/app/safe-hashes.sh --network ${NETWORKS.rsk} --address ${mockSafeAddressNoPrefix} --nonce ${TEST_CONSTANTS.DEFAULT_NONCE}`,
        );
        (callback as ExecCallback)(null, TEST_CONSTANTS.SUCCESS_OUTPUT, "");
        return createMockChildProcess();
      },
    );

    expectSuccessResult(
      await runSafeTxHashesTest(),
      TEST_CONSTANTS.SUCCESS_OUTPUT,
    );
  });

  test("should handle script error gracefully", async () => {
    const mockError = createMockError("Script execution failed");
    (exec as unknown as Mock).mockImplementation(
      createErrorExecMock(mockError),
    );

    expectErrorResult(
      await runSafeTxHashesTest(),
      "Error executing script: Script execution failed",
    );
  });

  test("should handle stderr output gracefully", async () => {
    const mockStderr = "Permission denied";
    (exec as unknown as Mock).mockImplementation(
      createStderrExecMock(mockStderr),
    );

    expectErrorResult(
      await runSafeTxHashesTest(),
      "Error executing script: Permission denied",
    );
  });

  test("should handle various success scenarios", async () => {
    const testCases = [
      {
        stdout: "Transaction hash: 0x123456789",
        description: "with transaction hash",
      },
      { stdout: "", description: "with empty output" },
      {
        stdout: TEST_CONSTANTS.SUCCESS_OUTPUT,
        description: "with simple success message",
      },
    ];

    for (const testCase of testCases) {
      (exec as unknown as Mock).mockImplementation(
        createSuccessExecMock(testCase.stdout),
      );

      expectSuccessResult(await runSafeTxHashesTest(), testCase.stdout);
    }
  });

  test("should support all network prefixes", async () => {
    (exec as unknown as Mock).mockImplementation(createSuccessExecMock());

    for (const prefix of Object.keys(NETWORKS)) {
      expectSuccessResult(
        await runSafeTxHashesTest(prefix),
        TEST_CONSTANTS.SUCCESS_OUTPUT,
      );
      expect(exec).toHaveBeenCalledWith(
        `/app/safe-hashes.sh --network ${NETWORKS[prefix]} --address ${mockSafeAddressNoPrefix} --nonce ${TEST_CONSTANTS.DEFAULT_NONCE}`,
        { timeout: 30000 },
        expect.any(Function),
      );
    }
  });

  test("should handle very large nonce values", async () => {
    (exec as unknown as Mock).mockImplementation(
      (cmd: unknown, options: unknown, callback: unknown) => {
        expect(cmd).toBe(
          `/app/safe-hashes.sh --network ${NETWORKS.rsk} --address ${mockSafeAddressNoPrefix} --nonce ${TEST_CONSTANTS.LARGE_NONCE}`,
        );
        (callback as ExecCallback)(null, TEST_CONSTANTS.SUCCESS_OUTPUT, "");
        return createMockChildProcess();
      },
    );

    const result = await runSafeTxHashesTest(
      rskPrefix,
      mockSafeAddressNoPrefix,
      TEST_CONSTANTS.LARGE_NONCE,
    );
    expectSuccessResult(result, TEST_CONSTANTS.SUCCESS_OUTPUT);
  });

  test("should handle network prefix case sensitivity", async () => {
    (exec as unknown as Mock).mockImplementation(createSuccessExecMock());

    expectSuccessResult(
      await runSafeTxHashesTest("RSK"),
      TEST_CONSTANTS.SUCCESS_OUTPUT,
    );

    expect(exec).toHaveBeenCalledWith(
      `/app/safe-hashes.sh --network undefined --address ${mockSafeAddressNoPrefix} --nonce ${TEST_CONSTANTS.DEFAULT_NONCE}`,
      { timeout: 30000 },
      expect.any(Function),
    );
  });

  describe("Error Handling", () => {
    test("should handle error with no message", async () => {
      const mockError = createMockError("");
      (exec as unknown as Mock).mockImplementation(
        createErrorExecMock(mockError),
      );

      expectErrorResult(
        await runSafeTxHashesTest(),
        "Error executing script: ",
      );
    });

    test("should handle non-empty stderr as error", async () => {
      const mockStderr = "Script execution warning";
      (exec as unknown as Mock).mockImplementation(
        createStderrExecMock(mockStderr),
      );

      expectErrorResult(
        await runSafeTxHashesTest(),
        "Error executing script: Script execution warning",
      );
    });
  });

  describe("Retry Logic", () => {
    test("should retry on error code 22", async () => {
      const mockError = createMockError(
        "Script failed",
        TEST_CONSTANTS.RETRY_ERROR_CODE,
      );
      let attemptCount = 0;

      (exec as unknown as Mock).mockImplementation(
        (cmd: unknown, options: unknown, callback: unknown) => {
          attemptCount++;
          if (attemptCount < TEST_CONSTANTS.MAX_RETRIES) {
            (callback as ExecCallback)(mockError, "", "");
          } else {
            (callback as ExecCallback)(null, "Success after retry", "");
          }
          return createMockChildProcess();
        },
      );

      expectSuccessResult(await runSafeTxHashesTest(), "Success after retry");
      expect(attemptCount).toBe(TEST_CONSTANTS.MAX_RETRIES);
    });

    test("should fail after max retries on error code 22", async () => {
      const mockError = createMockError(
        "Persistent script failure",
        TEST_CONSTANTS.RETRY_ERROR_CODE,
      );
      let attemptCount = 0;

      (exec as unknown as Mock).mockImplementation(
        (cmd: unknown, options: unknown, callback: unknown) => {
          attemptCount++;
          (callback as ExecCallback)(mockError, "", "");
          return createMockChildProcess();
        },
      );

      expectErrorResult(
        await runSafeTxHashesTest(),
        "Error executing script: Persistent script failure",
      );
      expect(attemptCount).toBe(TEST_CONSTANTS.MAX_RETRIES);
    });

    test("should not retry on non-22 error codes", async () => {
      const mockError = createMockError("Different error", 1);
      let attemptCount = 0;

      (exec as unknown as Mock).mockImplementation(
        (cmd: unknown, options: unknown, callback: unknown) => {
          attemptCount++;
          (callback as ExecCallback)(mockError, "", "");
          return createMockChildProcess();
        },
      );

      expectErrorResult(
        await runSafeTxHashesTest(),
        "Error executing script: Different error",
      );
      expect(attemptCount).toBe(1);
    });
  });

  describe("Timeout Handling", () => {
    test("should handle timeout (script waiting for input)", async () => {
      const mockError = createMockError("Process terminated", null, "SIGTERM");
      (exec as unknown as Mock).mockImplementation(
        createErrorExecMock(mockError),
      );

      expectErrorResult(
        await runSafeTxHashesTest(),
        TEST_CONSTANTS.TIMEOUT_ERROR_MESSAGE,
      );
    });

    test("should handle timeout with retry logic", async () => {
      const mockTimeoutError = createMockError(
        "Process terminated",
        null,
        "SIGTERM",
      );
      const mockError22 = createMockError(
        "Script failed",
        TEST_CONSTANTS.RETRY_ERROR_CODE,
      );
      let attemptCount = 0;

      (exec as unknown as Mock).mockImplementation(
        (cmd: unknown, options: unknown, callback: unknown) => {
          attemptCount++;
          if (attemptCount === 1) {
            (callback as ExecCallback)(mockError22, "", "");
          } else {
            (callback as ExecCallback)(mockTimeoutError, "", "");
          }
          return createMockChildProcess();
        },
      );

      expectErrorResult(
        await runSafeTxHashesTest(),
        TEST_CONSTANTS.TIMEOUT_ERROR_MESSAGE,
      );
      expect(attemptCount).toBe(2);
    });
  });
});

describe("parseResponse", () => {
  function expectParseResult(response: string, expected: any) {
    expect(parseResponse(response)).toEqual(expected);
  }

  describe("Valid Response Parsing", () => {
    test("should parse complete valid response", () => {
      expectParseResult(
        mockSafeHashesResponse,
        expectedParsedSafeHashesResponse,
      );
    });

    test("should handle missing optional fields", () => {
      expectParseResult(
        mockSafeHashesResponseNoAdditionalFields,
        expectedParsedSafeHashesResponseNoAdditionalFields,
      );
    });

    test("should handle empty response", () => {
      expectParseResult("", expectedParsedSafeHashesResponseEmpty);
    });
  });

  describe("Malformed Response Handling", () => {
    test("should handle various malformed responses gracefully", () => {
      const testCases = [
        {
          description: "completely invalid lines",
          response: `
Invalid line
Another invalid line
`,
          expectEmpty: true,
        },
        {
          description: "partial field matches without values",
          response: `
Multisig address: 
To: 
Value: 
Data: 
Encoded message: 
Legacy Ledger Format
Binary string literal: 
Domain hash: 
Message hash: 
Safe transaction hash: 
`,
          expectEmpty: false,
          expectedValue: 0,
        },
        {
          description: "fields with colon but no value",
          response: `
Multisig address:
To:
Value:
`,
          expectEmpty: false,
          expectedValue: 0,
        },
      ];

      for (const testCase of testCases) {
        const result = parseResponse(testCase.response);

        if (testCase.expectEmpty) {
          expect(result).toEqual(expectedParsedSafeHashesResponseEmpty);
        } else {
          expect(result.transactionData.value).toBe(testCase.expectedValue);
          expect(result.transactionData.multisigAddress).toBe("");
          expect(result.transactionData.to).toBe("");
        }
      }
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

    test("should handle response with field names in content", () => {
      const mockResponse = `
Some content with Value: inside description
Multisig address: 0x1234567890123456789012345678901234567890
To: 0xabcdef1234567890abcdef1234567890abcdef12
Value: 1000
Data: 0x1234567890abcdef contains To: in the data
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
      expect(result.transactionData.to).toBe(
        "0xabcdef1234567890abcdef1234567890abcdef12",
      );
    });
  });

  describe("Parameter Extraction Edge Cases", () => {
    test("should handle edge cases in parameter extraction", () => {
      const testCases = [
        {
          description: "parameters with proper format",
          response: `
Parameters: [
  {
    "name": "test",
    "value": "123"
  }
]

Legacy Ledger Format
`,
          expectNull: false,
        },
        {
          description: "empty parameters array",
          response: `
Parameters: []

Legacy Ledger Format
`,
          expectNull: false,
        },
        {
          description: "parameters with no Legacy Ledger Format marker",
          response: `
Parameters: [
  {
    "name": "test"
  }
`,
          expectNull: true,
        },
      ];

      for (const testCase of testCases) {
        const result = parseResponse(testCase.response);

        if (testCase.expectNull) {
          expect(result.transactionData.parameters).toBeNull();
        } else {
          expect(result.transactionData.parameters).not.toBeNull();
        }
      }
    });
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
