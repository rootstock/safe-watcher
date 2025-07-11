import type { Block, KnownBlock } from "@slack/types";
import { WebClient } from "@slack/web-api";

import logger from "../logger.js";
import { SAFE_API_URLS } from "../safe/constants.js";
import type {
  SafeTxHashesResponse,
  TxHashError,
} from "../safe-hashes/index.js";
import type { Event, INotifier } from "../types.js";

export interface SlackOptions {
  slackBotToken: string;
  slackChannelId: string;
}

interface SlackMessage {
  blocks: (Block | KnownBlock)[];
  text: string;
}

export class Slack implements INotifier {
  readonly #apiToken: string;
  readonly #channelId: string;

  constructor(opts: SlackOptions) {
    this.#apiToken = opts.slackBotToken;
    this.#channelId = opts.slackChannelId;
  }

  public async send(
    event: Event,
    safeTxHashes?: SafeTxHashesResponse | TxHashError,
  ): Promise<void> {
    const message: SlackMessage = this.#formatMessage(event, safeTxHashes);
    await this.#sendToSlack(message);
  }

  #formatMessage(
    event: Event,
    safeTxHashes?: SafeTxHashesResponse | TxHashError,
  ): SlackMessage {
    const { type, chainPrefix, safe, tx, name } = event;

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `:alert: Transaction ${type} on ${name}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:chains: *Chain:* ${chainPrefix.toUpperCase()}\n:shield: *Safe:* \`${safe}\`\n:id: *Tx Hash:* \`${tx.safeTxHash}\`\n:mag: *Nonce:* \`${tx.nonce}\`\n:pencil2: *Signatures*: ${tx.confirmations.length}/${tx.confirmationsRequired}\n:lower_left_crayon: *Proposer*: ${this.#formatSigner(tx.proposer)}\n:lower_left_fountain_pen: *Signers*: ${tx.confirmations.map(this.#formatSigner).join(", ")}`,
        },
      },
      {
        type: "divider",
      },
    ];

    if (safeTxHashes) {
      if (safeTxHashes instanceof Error) {
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*ERROR:* ${safeTxHashes.message}`,
            },
          },
          {
            type: "divider",
          },
        );
      } else if ("transactionData" in safeTxHashes) {
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Safe Transaction details*",
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:person: *To*: \`${safeTxHashes.transactionData.to}\`\n
:money: *Value*: \`${safeTxHashes.transactionData.value}\`\n
:bookmark: *Data*: \`${safeTxHashes.transactionData.data}\`\n
:notebook: *Encoded Message*: \`\`\`${safeTxHashes.transactionData.encodedMessage}\`\`\`\n
:moneybag: *Method*: \`${safeTxHashes.transactionData.method}\`\n
:gear: *Parameters*: \`${safeTxHashes.transactionData.parameters}\`\n
:books: *Binary String Literal*: \`${safeTxHashes.legacyLedgerFormat.binaryStringLiteral}\`\n
:hash: *Domain Hash*: \`${safeTxHashes.hashes.domainHash}\`\n
:hash: *Message Hash*: \`${safeTxHashes.hashes.messageHash}\`\n
:id: *Transaction Hash*: \`${safeTxHashes.hashes.safeTransactionHash}\``,
            },
          },
          {
            type: "divider",
          },
        );
      }
    }

    blocks.push(
      {
        type: "section",
        text: {
          type: "plain_text",
          text: "View Transaction on Safe website",
          emoji: true,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Click Me",
            emoji: true,
          },
          value: "view_transaction",
          url: `${SAFE_API_URLS[chainPrefix.trim()]}/${chainPrefix.trim()}:${safe}/transactions/queue`,
          action_id: "button-action",
        },
      },
      {
        type: "divider",
      },
    );

    // Add alert for malicious transactions
    if (type === "malicious") {
      blocks.unshift(
        {
          type: "header",
          text: {
            type: "plain_text",
            text: ":alert: ALERT! ACTION REQUIRED: MALICIOUS TRANSACTION DETECTED! :alert:",
            emoji: true,
          },
        },
        {
          type: "divider",
        },
      );
    }

    return {
      blocks,
      text: `Transaction ${type} on ${name}`,
    };
  }

  #formatSigner(signer: { address: string; name?: string }): string {
    return signer.name ? `*${signer.name}*` : `\`${signer.address}\``;
  }

  async #sendToSlack(message: SlackMessage): Promise<void> {
    if (!this.#apiToken && !this.#channelId) {
      logger.warn("slack not configured");
      return;
    }

    const webClient = new WebClient(this.#apiToken);

    try {
      const response = await webClient.chat.postMessage({
        channel: this.#channelId,
        text: message.text,
        blocks: message.blocks,
      });

      if (response.ok) {
        logger.debug("slack message sent successfully");
      } else {
        throw new Error(`${response}`);
      }
    } catch (err) {
      logger.error({ err, message }, "cannot send to slack");
    }
  }
}
