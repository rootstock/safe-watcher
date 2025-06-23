import { expect, jest } from "@jest/globals";
import type { Address, Hash } from "viem";

import type { ISafeAPI, ListedSafeTx, SafeTx } from "../src/safe/types.js";
import SafeWatcher from "../src/SafeWatcher.js";
import type { Event, INotificationSender } from "../src/types.js";
import {
  mockDetailedTx,
  mockListedAnotherTx,
  mockListedTx,
  mockMaliciousTx,
  mockSafeAddressAlias,
  mockSafeAddressNoPrefix,
  mockSafeAddressWithAlias,
  mockSignerAddress,
  rskPrefix,
} from "./utils/config-utils.js";

// Mock MULTISEND_CALL_ONLY
jest.mock("../src/safe/constants.js", () => ({
  MULTISEND_CALL_ONLY: new Set(["0x1234def" as Address]),
}));

// Helper functions for test setup
function createMockApi(
  overrides: Partial<{
    fetchAll: jest.Mock<() => Promise<ListedSafeTx[]>>;
    fetchLatest: jest.Mock<() => Promise<ListedSafeTx[]>>;
    fetchDetailed: jest.Mock<(hash: Hash) => Promise<SafeTx<Address>>>;
  }> = {},
) {
  return {
    fetchAll: jest.fn<() => Promise<ListedSafeTx[]>>().mockResolvedValue([]),
    fetchLatest: jest.fn<() => Promise<ListedSafeTx[]>>().mockResolvedValue([]),
    fetchDetailed: jest
      .fn<(hash: Hash) => Promise<SafeTx<Address>>>()
      .mockResolvedValue(mockDetailedTx),
    ...overrides,
  } as ISafeAPI;
}

function createTestWatcher(
  options: {
    api?: ISafeAPI;
    notifier?: ReturnType<typeof createMockNotifier>["notifier"];
  } = {},
) {
  const { api = createMockApi(), notifier } = options;
  return new SafeWatcher({
    safe: mockSafeAddressWithAlias,
    api,
    notifier,
    signers: mockSignerAddress,
  });
}

// Mock SafeTxHashes
jest.mock("../src/safe-hashes/index.js", () => {
  return {
    SafeTxHashes: jest.fn().mockImplementation(() =>
      Promise.resolve({
        success: true,
        data: "mock response",
      }),
    ),
    parseResponse: jest.fn().mockImplementation(() => ({
      transactionData: {
        to: "0x123",
        value: 0,
        data: "0x",
        encodedMessage: "0x",
        method: null,
        parameters: null,
      },
      legacyLedgerFormat: {
        binaryStringLiteral: "",
      },
      hashes: {
        domainHash: "0x",
        messageHash: "0x",
        safeTransactionHash: "0x",
      },
    })),
  };
});

// Mock the SafeApiWrapper class
jest.mock("../src/safe/index.js", () => {
  const actual = jest.requireActual("../src/safe/index.js");
  return Object.assign({}, actual, {
    SafeApiWrapper: jest.fn().mockImplementation(() => ({
      fetchAll: jest
        .fn<() => Promise<ListedSafeTx[]>>()
        .mockResolvedValue([] as ListedSafeTx[]),
      fetchLatest: jest
        .fn<() => Promise<ListedSafeTx[]>>()
        .mockResolvedValue([] as ListedSafeTx[]),
      fetchDetailed: jest
        .fn<(hash: string) => Promise<SafeTx<`0x${string}`>>>()
        .mockResolvedValue(mockDetailedTx),
    })) as unknown as ISafeAPI,
    MULTISEND_CALL_ONLY: new Set(["0x1234def"]),
  });
});

// Create a simple mock notifier
function createMockNotifier(): {
  notifier: INotificationSender;
  mock: jest.MockedFunction<any>;
} {
  const mock = jest.fn(async (..._args: any[]) => {
    return Promise.resolve();
  });
  return {
    notifier: { notify: mock },
    mock,
  };
}

describe("SafeWatcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initialization", () => {
    test("should initialize with correct safe address and name", () => {
      const safewatcher = createTestWatcher();
      expect(safewatcher.prefix).toBe(rskPrefix);
      expect(safewatcher.safe).toBe(mockSafeAddressNoPrefix);
      expect(safewatcher.name).toBe(mockSafeAddressAlias);
    });

    test("should throw error for invalid safe address", () => {
      const invalidSafe = { "rsk:invalid": "Test" };
      const create = () => new SafeWatcher({ safe: invalidSafe });
      expect(create).toThrow("invalid prefixed safe address 'rsk:invalid'");
    });
  });

  describe("Transaction Monitoring", () => {
    test("should start monitoring and fetch initial transactions", async () => {
      const mockApi = createMockApi({
        fetchAll: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx, mockListedAnotherTx]),
      });
      const safewatcher = createTestWatcher({ api: mockApi });
      await safewatcher.start(0);
      await safewatcher["poll"]();
      safewatcher.stop();
      expect(safewatcher.txs.size).toBe(2);
      expect(
        safewatcher.txs.get(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
      ).toBeDefined();
      expect(
        safewatcher.txs.get(
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ),
      ).toBeDefined();
    });

    test("should detect new transactions", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });
      watcher.txs.clear();
      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();
      expect(mock).toHaveBeenCalled();
      const event = mock.mock.calls[0][0] as Event;
      expect(event.type).toBe("created");
    });

    test("should detect malicious transactions", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
        fetchDetailed: jest
          .fn<(hash: Hash) => Promise<SafeTx<Address>>>()
          .mockResolvedValue(mockMaliciousTx),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });
      watcher.txs.clear();
      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();
      expect(mock).toHaveBeenCalled();
      const event = mock.mock.calls[0][0] as Event;
      expect(event.type).toBe("malicious");
    });

    test("should handle SafeTxHashes failure gracefully", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });

      // Mock SafeTxHashes to fail
      const { SafeTxHashes } = require("../src/safe-hashes/index.js");
      SafeTxHashes.mockImplementationOnce(() =>
        Promise.resolve({
          success: false,
          error: "Failed to get hashes",
        }),
      );

      const watcher = createTestWatcher({ api: mockApi, notifier });
      watcher.txs.clear();
      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();

      expect(mock).toHaveBeenCalled();
      const event = mock.mock.calls[0][0] as Event;
      expect(event.type).toBe("created");
      // Verify that notification was sent without safeTxHashes
      expect(mock.mock.calls[0][1]).toEqual({
        message: "Failed to get hashes",
      });
    });
  });

  describe("Error Handling", () => {
    test("should handle API errors gracefully", async () => {
      const mockApi = createMockApi({
        fetchAll: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockRejectedValue(new Error("API Error")),
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockRejectedValue(new Error("API Error")),
        fetchDetailed: jest
          .fn<(hash: Hash) => Promise<SafeTx<Address>>>()
          .mockRejectedValue(new Error("API Error")),
      });
      const safewatcher = createTestWatcher({ api: mockApi });
      await expect(safewatcher.start(0)).rejects.toThrow("API Error");
    });

    test("should handle fetchDetailed errors in poll", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
        fetchDetailed: jest
          .fn<(hash: Hash) => Promise<SafeTx<Address>>>()
          .mockRejectedValue(new Error("API Error")),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });

      await watcher.start(0);
      await watcher["poll"]();

      expect(mock).not.toHaveBeenCalled();
    });
  });

  describe("Transaction Processing", () => {
    test("should handle transaction updates correctly", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });

      // First add the transaction
      await watcher.start(0);
      await watcher["poll"]();

      // Then update it
      const updatedTx = { ...mockListedTx, confirmations: 1 };
      const mockFetchLatest = mockApi.fetchLatest as jest.Mock<
        () => Promise<ListedSafeTx[]>
      >;
      mockFetchLatest.mockResolvedValueOnce([updatedTx]);
      await watcher["poll"]();

      expect(mock).toHaveBeenCalledTimes(2);
      const updateEvent = mock.mock.calls[1][0] as Event;
      expect(updateEvent.type).toBe("updated");
    });

    test("should handle executed transactions", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });

      // First add the transaction
      await watcher.start(0);
      await watcher["poll"]();

      // Then mark it as executed
      const executedTx = { ...mockListedTx, isExecuted: true };
      const mockFetchLatest = mockApi.fetchLatest as jest.Mock<
        () => Promise<ListedSafeTx[]>
      >;
      mockFetchLatest.mockResolvedValueOnce([executedTx]);
      await watcher["poll"]();

      expect(mock).toHaveBeenCalledTimes(2);
      const executeEvent = mock.mock.calls[1][0] as Event;
      expect(executeEvent.type).toBe("executed");
    });
  });

  describe("Watcher Lifecycle", () => {
    test("should stop polling when stop is called", async () => {
      const watcher = createTestWatcher();

      await watcher.start(100); // Start with 100ms interval
      expect(watcher.interval).toBeDefined();

      watcher.stop();
      expect(watcher.interval).toBeUndefined();
    });

    test("should not start polling with zero interval", async () => {
      const watcher = createTestWatcher();

      await watcher.start(0);
      expect(watcher.interval).toBeUndefined();
    });
  });

  describe("Constructor Variations", () => {
    test("should initialize with SafeApiWrapper when api is string", () => {
      const watcher = new SafeWatcher({
        safe: mockSafeAddressWithAlias,
        api: "fallback",
        signers: mockSignerAddress,
      });
      expect(watcher.prefix).toBe(rskPrefix);
      expect(watcher.safe).toBe(mockSafeAddressNoPrefix);
    });

    test("should initialize with custom ISafeAPI object", () => {
      const customApi = createMockApi();
      const watcher = new SafeWatcher({
        safe: mockSafeAddressWithAlias,
        api: customApi,
        signers: mockSignerAddress,
      });
      expect(watcher.prefix).toBe(rskPrefix);
      expect(watcher.safe).toBe(mockSafeAddressNoPrefix);
    });

    test("should initialize without optional parameters", () => {
      const watcher = new SafeWatcher({
        safe: mockSafeAddressWithAlias,
      });
      expect(watcher.prefix).toBe(rskPrefix);
      expect(watcher.safe).toBe(mockSafeAddressNoPrefix);
      expect(watcher.name).toBe(mockSafeAddressAlias);
    });

    test("should handle safe address with no alias", () => {
      const watcher = new SafeWatcher({
        safe: { "rsk:0x0000000000000000000000000000000000000001": "" },
      });
      expect(watcher.name).toBe("");
    });
  });

  describe("Utility Functions", () => {
    test("should return correct safe address with getSafeAddress", () => {
      const watcher = createTestWatcher();
      expect(watcher.getSafeAddress()).toBe(
        "rsk:0x0000000000000000000000000000000000000001",
      );
    });

    test("should return poll interval with getPollInterval", async () => {
      const watcher = createTestWatcher();
      expect(watcher.getPollInterval()).toBeUndefined();

      await watcher.start(5000);
      expect(watcher.getPollInterval()).toBe(5000);
      watcher.stop();
    });
  });

  describe("Checksum Address Handling", () => {
    test("should handle RSK checksum addresses", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });

      // Create a watcher with RSK prefix
      const watcher = new SafeWatcher({
        safe: { "rsk:0x0000000000000000000000000000000000000001": "RSK Safe" },
        api: mockApi,
        notifier,
        signers: { "0x0000000000000000000000000000000000000002": "RSK Signer" },
      });

      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();

      expect(mock).toHaveBeenCalled();
    });

    test("should handle TRSK checksum addresses", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });

      // Create a watcher with TRSK prefix
      const watcher = new SafeWatcher({
        safe: {
          "trsk:0x0000000000000000000000000000000000000001": "TRSK Safe",
        },
        api: mockApi,
        notifier,
        signers: {
          "0x0000000000000000000000000000000000000002": "TRSK Signer",
        },
      });

      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();

      expect(mock).toHaveBeenCalled();
    });

    test("should handle non-RSK/TRSK checksum addresses", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });

      // Create a watcher with ETH prefix
      const watcher = new SafeWatcher({
        safe: { "eth:0x0000000000000000000000000000000000000001": "ETH Safe" },
        api: mockApi,
        notifier,
        signers: { "0x0000000000000000000000000000000000000002": "ETH Signer" },
      });

      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();

      expect(mock).toHaveBeenCalled();
    });
  });

  describe("SafeTx Hash Processing Edge Cases", () => {
    test("should handle SafeTxHashes parse error", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });

      // Mock SafeTxHashes to return success but parseResponse to fail
      const {
        SafeTxHashes,
        parseResponse,
      } = require("../src/safe-hashes/index.js");
      SafeTxHashes.mockImplementationOnce(() =>
        Promise.resolve({
          success: true,
          data: "invalid response",
        }),
      );
      parseResponse.mockImplementationOnce(() => {
        throw new Error("Parse error");
      });

      const watcher = createTestWatcher({ api: mockApi, notifier });
      watcher.txs.clear();
      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();

      expect(mock).toHaveBeenCalled();
      // Should receive error object
      expect(mock.mock.calls[0][1]).toEqual({
        message: "Failed to parse SafeTxHahes response",
      });
    });

    test("should handle SafeTxHashes with no success and no error", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });

      // Mock SafeTxHashes to return neither success nor error
      const { SafeTxHashes } = require("../src/safe-hashes/index.js");
      SafeTxHashes.mockImplementationOnce(() =>
        Promise.resolve({
          success: false,
          // no error field
        }),
      );

      const watcher = createTestWatcher({ api: mockApi, notifier });
      watcher.txs.clear();
      await watcher.start(0);
      await watcher["poll"]();
      watcher.stop();

      expect(mock).toHaveBeenCalled();
    });
  });

  describe("Transaction Update Edge Cases", () => {
    test("should skip update when transaction has no changes", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });

      // First add the transaction
      await watcher.start(0);
      await watcher["poll"]();

      // Update with same values (no real change)
      const unchangedTx = { ...mockListedTx }; // Same isExecuted and confirmations
      const mockFetchLatest = mockApi.fetchLatest as jest.Mock<
        () => Promise<ListedSafeTx[]>
      >;
      mockFetchLatest.mockResolvedValueOnce([unchangedTx]);
      await watcher["poll"]();

      // Should only be called once (for creation, not for the "update")
      expect(mock).toHaveBeenCalledTimes(1);
    });

    test("should handle transaction with confirmation count change", async () => {
      const { notifier, mock } = createMockNotifier();
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
      });
      const watcher = createTestWatcher({ api: mockApi, notifier });

      // First add the transaction
      await watcher.start(0);
      await watcher["poll"]();

      // Update confirmations count only
      const updatedTx = { ...mockListedTx, confirmations: 2 };
      const mockFetchLatest = mockApi.fetchLatest as jest.Mock<
        () => Promise<ListedSafeTx[]>
      >;
      mockFetchLatest.mockResolvedValueOnce([updatedTx]);
      await watcher["poll"]();

      expect(mock).toHaveBeenCalledTimes(2);
      const updateEvent = mock.mock.calls[1][0] as Event;
      expect(updateEvent.type).toBe("updated");
    });
  });

  describe("Error Handling Edge Cases", () => {
    test("should handle errors in poll loop and continue", async () => {
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockResolvedValue([mockListedTx]),
        fetchDetailed: jest
          .fn<(hash: Hash) => Promise<SafeTx<Address>>>()
          .mockRejectedValueOnce(new Error("Fetch detailed error"))
          .mockResolvedValue(mockDetailedTx),
      });

      const watcher = createTestWatcher({ api: mockApi });

      await watcher.start(0);
      // This should handle the error and not throw
      await watcher["poll"]();
      watcher.stop();

      // Verify that fetchDetailed was called and errored
      expect(mockApi.fetchDetailed).toHaveBeenCalled();
    });

    test("should handle error in start interval callback", async () => {
      const mockApi = createMockApi({
        fetchLatest: jest
          .fn<() => Promise<ListedSafeTx[]>>()
          .mockRejectedValue(new Error("Poll error")),
      });

      const watcher = createTestWatcher({ api: mockApi });

      // Start with a short interval to test error handling
      await watcher.start(1);

      // Wait for the interval to trigger and handle error
      await new Promise(resolve => setTimeout(resolve, 10));

      watcher.stop();

      // The error should be caught and logged, not thrown
      expect(mockApi.fetchLatest).toHaveBeenCalled();
    });
  });
});
