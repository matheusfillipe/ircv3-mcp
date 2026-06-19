import { z } from 'zod';

export const AccountConfigSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().default(6697),
  tls: z.boolean().default(true),
  nick: z.string().min(1),
  username: z.string().optional(),
  realname: z.string().optional(),
  sasl: z
    .object({
      mech: z.enum(['PLAIN', 'EXTERNAL', 'SCRAM-SHA-256']),
      account: z.string(),
    })
    .nullable()
    .default(null),
  channels: z.array(z.string()).default([]),
  default: z.boolean().optional(),
  allowRaw: z.boolean().default(true),
});

export type AccountConfig = z.infer<typeof AccountConfigSchema>;

export const ConfigSchema = z.object({
  accounts: z.array(AccountConfigSchema).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
