import { z } from 'zod';
import { renderTranscript } from './render';
import { getAccount } from '../config/store';
import { setCursor } from '../state/cursors';
import type { SessionPool } from './session';
import type { Selector } from '../irc-core/chathistory';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  outputSchema?: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, boolean | undefined>;
}

export interface ToolDef {
  name: string;
  config: ToolConfig;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function errResult(msg: string): ToolResult {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

export function makeTools(ctx: { pool: SessionPool }): ToolDef[] {
  const { pool } = ctx;

  return [
    {
      name: 'irc_list_networks',
      config: {
        title: 'List IRC networks',
        description: 'List all configured IRC networks and their connection status.',
        inputSchema: {},
        outputSchema: {
          networks: z.array(
            z.object({
              name: z.string(),
              host: z.string(),
              default: z.boolean(),
              connected: z.boolean(),
              nick: z.string().optional(),
            }),
          ),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      handler: async (_args: Record<string, unknown>) => {
        const networks = pool.status();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(networks) }],
          structuredContent: { networks },
        };
      },
    },

    {
      name: 'irc_status',
      config: {
        title: 'IRC connection status',
        description: 'Show the current connection status for an IRC account.',
        inputSchema: { account: z.string().optional() },
        outputSchema: {
          account: z.string(),
          nick: z.string().optional(),
          connected: z.boolean(),
          network: z.string().optional(),
          caps: z.array(z.string()),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account } = args as { account?: string };
          const client = await pool.get(account);
          const result = {
            account: account ?? '',
            nick: client.nick,
            connected: client.connected,
            network: client.isupport.network,
            caps: Array.from(client.enabledCaps),
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_read_history',
      config: {
        title: 'Read IRC message history',
        description:
          'Fetch recent messages from a channel or DM. Use msgid values from results for reply/react/redact.',
        inputSchema: {
          account: z.string().optional(),
          target: z.string(),
          mode: z.enum(['latest', 'before', 'after', 'around']).optional(),
          msgid: z.string().optional(),
          limit: z.number().int().positive().optional(),
          format: z.enum(['markdown', 'structured', 'both']).optional(),
        },
        outputSchema: {
          messages: z.array(z.unknown()),
          markdown: z.string().optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const {
            account,
            target,
            mode: modeArg,
            msgid,
            limit: limitArg,
            format: formatArg,
          } = args as {
            account?: string;
            target: string;
            mode?: 'latest' | 'before' | 'after' | 'around';
            msgid?: string;
            limit?: number;
            format?: 'markdown' | 'structured' | 'both';
          };
          const mode = modeArg ?? 'latest';
          const limit = limitArg ?? 50;
          const format = formatArg ?? 'markdown';

          let selector: Selector;
          if (msgid) {
            selector = { type: 'msgid', value: msgid };
          } else if (mode === 'latest') {
            selector = { type: 'star' };
          } else {
            return errResult(
              `Error: mode '${mode}' requires a msgid to use as reference point. Provide the msgid parameter.`,
            );
          }

          const accountName = getAccount(account).name;
          const client = await pool.get(account);
          const messages = await client.readHistory({ target, mode, selector, limit });
          const markdown = renderTranscript(messages, client.reactions);

          if (messages.length > 0) {
            const newest = messages[messages.length - 1]!;
            setCursor(accountName, target, { msgid: newest.msgid, time: newest.time });
          }

          const structuredContent: { messages: typeof messages; markdown?: string } = { messages };
          if (format !== 'structured') structuredContent.markdown = markdown;

          const text = format !== 'structured' ? markdown : JSON.stringify(messages);
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent,
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_list_conversations',
      config: {
        title: 'List active IRC conversations',
        description: 'List channels and DMs that had activity in the given time window.',
        inputSchema: {
          account: z.string().optional(),
          hours: z.number().positive().optional(),
          limit: z.number().int().positive().optional(),
        },
        outputSchema: {
          conversations: z.array(
            z.object({ target: z.string(), latestTime: z.string().optional() }),
          ),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const {
            account,
            hours: hoursArg,
            limit: limitArg,
          } = args as {
            account?: string;
            hours?: number;
            limit?: number;
          };
          const hours = hoursArg ?? 24;
          const limit = limitArg ?? 50;
          const end = new Date().toISOString();
          const start = new Date(Date.now() - hours * 3_600_000).toISOString();
          const client = await pool.get(account);
          const conversations = await client.listConversations({ start, end, limit });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(conversations) }],
            structuredContent: { conversations },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_list_members',
      config: {
        title: 'List IRC channel members',
        description: 'List the current members of a channel with their mode prefixes.',
        inputSchema: { account: z.string().optional(), channel: z.string() },
        outputSchema: {
          members: z.array(z.object({ nick: z.string(), prefixes: z.string() })),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, channel } = args as { account?: string; channel: string };
          const client = await pool.get(account);
          const members = await client.listMembers(channel);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(members) }],
            structuredContent: { members },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_whois',
      config: {
        title: 'IRC WHOIS lookup',
        description: 'Look up information about a nick on IRC.',
        inputSchema: { account: z.string().optional(), nick: z.string() },
        outputSchema: {
          nick: z.string(),
          account: z.string().optional(),
          realname: z.string().optional(),
          channels: z.string().optional(),
          lines: z.array(z.string()),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, nick } = args as { account?: string; nick: string };
          const client = await pool.get(account);
          const result = await client.whois(nick);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_send_message',
      config: {
        title: 'Send IRC message',
        description:
          'Send a message to a channel or user. Provide text (single line) or lines (multiline array). Use in_reply_to with a msgid to thread replies.',
        inputSchema: {
          account: z.string().optional(),
          target: z.string(),
          text: z.string().optional(),
          lines: z.array(z.string()).optional(),
          notice: z.boolean().optional(),
          in_reply_to: z.string().optional(),
        },
        outputSchema: { msgid: z.string().optional() },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const {
            account,
            target,
            text,
            lines: linesArg,
            notice,
            in_reply_to,
          } = args as {
            account?: string;
            target: string;
            text?: string;
            lines?: string[];
            notice?: boolean;
            in_reply_to?: string;
          };
          const lines = linesArg ?? (text !== undefined ? [text] : undefined);
          if (!lines) {
            return errResult('Error: provide either text or lines to send a message.');
          }
          const client = await pool.get(account);
          const result = await client.sendMessage({
            target,
            lines,
            notice,
            inReplyTo: in_reply_to,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_react',
      config: {
        title: 'React to an IRC message',
        description: 'Add or remove an emoji reaction on a message identified by its msgid.',
        inputSchema: {
          account: z.string().optional(),
          target: z.string(),
          msgid: z.string(),
          emoji: z.string(),
          remove: z.boolean().optional(),
        },
        outputSchema: { ok: z.literal(true) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, target, msgid, emoji, remove } = args as {
            account?: string;
            target: string;
            msgid: string;
            emoji: string;
            remove?: boolean;
          };
          const client = await pool.get(account);
          await client.react({ target, msgid, emoji, remove });
          return {
            content: [{ type: 'text' as const, text: '{"ok":true}' }],
            structuredContent: { ok: true as const },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_join',
      config: {
        title: 'Join an IRC channel',
        description: 'Join a channel, optionally with a key (password).',
        inputSchema: {
          account: z.string().optional(),
          channel: z.string(),
          key: z.string().optional(),
        },
        outputSchema: { ok: z.literal(true) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, channel, key } = args as {
            account?: string;
            channel: string;
            key?: string;
          };
          const client = await pool.get(account);
          client.join(channel, key);
          return {
            content: [{ type: 'text' as const, text: '{"ok":true}' }],
            structuredContent: { ok: true as const },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_part',
      config: {
        title: 'Leave an IRC channel',
        description: 'Leave a channel with an optional parting reason.',
        inputSchema: {
          account: z.string().optional(),
          channel: z.string(),
          reason: z.string().optional(),
        },
        outputSchema: { ok: z.literal(true) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, channel, reason } = args as {
            account?: string;
            channel: string;
            reason?: string;
          };
          const client = await pool.get(account);
          client.part(channel, reason);
          return {
            content: [{ type: 'text' as const, text: '{"ok":true}' }],
            structuredContent: { ok: true as const },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_mark_read',
      config: {
        title: 'Mark IRC conversation as read',
        description: 'Send a read marker up to the given timestamp for a target.',
        inputSchema: {
          account: z.string().optional(),
          target: z.string(),
          timestamp: z.string(),
        },
        outputSchema: { ok: z.literal(true) },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, target, timestamp } = args as {
            account?: string;
            target: string;
            timestamp: string;
          };
          const resolvedAccount = getAccount(account).name;
          const client = await pool.get(account);
          client.markRead(target, timestamp);
          setCursor(resolvedAccount, target, { time: timestamp });
          return {
            content: [{ type: 'text' as const, text: '{"ok":true}' }],
            structuredContent: { ok: true as const },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_redact',
      config: {
        title: 'Redact an IRC message',
        description:
          'Redact (delete) a message by its msgid. This is destructive and cannot be undone.',
        inputSchema: {
          account: z.string().optional(),
          target: z.string(),
          msgid: z.string(),
          reason: z.string().optional(),
        },
        outputSchema: { ok: z.literal(true) },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, target, msgid, reason } = args as {
            account?: string;
            target: string;
            msgid: string;
            reason?: string;
          };
          const client = await pool.get(account);
          client.redact(target, msgid, reason);
          return {
            content: [{ type: 'text' as const, text: '{"ok":true}' }],
            structuredContent: { ok: true as const },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },

    {
      name: 'irc_send_raw',
      config: {
        title: 'Send raw IRC line',
        description:
          'Send a raw IRC protocol line. Destructive and unrestricted — use only when no higher-level tool fits.',
        inputSchema: { account: z.string().optional(), line: z.string() },
        outputSchema: { sent: z.literal(true) },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const { account, line } = args as { account?: string; line: string };
          const acc = getAccount(account);
          if (acc.allowRaw === false) {
            return errResult(`Error: raw IRC is disabled for account '${acc.name}'`);
          }
          const client = await pool.get(account);
          client.send(line);
          return {
            content: [{ type: 'text' as const, text: '{"sent":true}' }],
            structuredContent: { sent: true as const },
          };
        } catch (e) {
          if (e instanceof Error) return errResult('Error: ' + e.message);
          throw e;
        }
      },
    },
  ];
}
