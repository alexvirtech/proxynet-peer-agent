import { ethers } from 'ethers';
import crypto from 'crypto';
import { fetchJSON } from '../lib/api.js';
import { log } from '../lib/logger.js';

export function deriveWallet(password) {
  const seed = crypto.pbkdf2Sync(password, 'proxynet-embedded-wallet-v2', 100000, 32, 'sha256');
  return new ethers.Wallet('0x' + seed.toString('hex'));
}

export async function authenticate(config) {
  const wallet = deriveWallet(config.nodeSecret);
  const address = wallet.address.toLowerCase();
  log.info('auth.start', { address: `${address.slice(0, 8)}...${address.slice(-4)}` });

  // Step 1: Get challenge
  const challengeRes = await fetchJSON('POST', `${config.apiBaseUrl}/api/auth/challenge`, { address });
  const challenge = challengeRes.data || challengeRes;
  log.debug('auth.challenge', { challengeId: challenge.challenge_id });

  // Step 2: Sign challenge
  const signature = await wallet.signMessage(challenge.message);

  // Step 3: Verify
  const verifyRes = await fetchJSON('POST', `${config.apiBaseUrl}/api/auth/verify`, {
    challenge_id: challenge.challenge_id,
    address,
    signature,
  });

  const result = verifyRes.data || verifyRes;
  log.info('auth.success', {
    userId: result.user.id,
    address: `${address.slice(0, 8)}...${address.slice(-4)}`,
    mode: result.user.account_mode,
  });

  return {
    token: result.access_token,
    refreshToken: result.refresh_token,
    userId: result.user.id,
    address,
  };
}

export async function refreshToken(config, currentRefreshToken) {
  const res = await fetchJSON('POST', `${config.apiBaseUrl}/api/auth/refresh`, {
    refresh_token: currentRefreshToken,
  });
  const data = res.data || res;
  return data.access_token;
}
