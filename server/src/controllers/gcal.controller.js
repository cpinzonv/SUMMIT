import { z } from 'zod';
import * as gcal from '../services/gcal.service.js';
import { env } from '../config/env.js';

const REDIRECT = () => env.lms.redirectUri; // shared frontend callback route

export const connectSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
  redirectUri: z.string().optional(),
});

export const enabledSchema = z.object({ enabled: z.boolean() });

export async function status(req, res) {
  res.json(await gcal.getStatus(req.user.id));
}

export async function authUrl(req, res) {
  const { url, state } = gcal.buildAuthUrl(req.user.id, REDIRECT());
  res.json({ url, state, redirectUri: REDIRECT() });
}

export async function connect(req, res) {
  res.json(await gcal.connect(req.user.id, { code: req.body.code, redirectUri: req.body.redirectUri || REDIRECT() }));
}

export async function disconnect(req, res) {
  res.json(await gcal.disconnect(req.user.id));
}

export async function setEnabled(req, res) {
  res.json(await gcal.setEnabled(req.user.id, req.body.enabled));
}

export async function sync(req, res) {
  res.json(await gcal.sync(req.user.id));
}
