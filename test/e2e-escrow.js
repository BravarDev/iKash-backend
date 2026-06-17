const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const StellarSdk = require('@stellar/stellar-sdk');

// Configuration
const BASE_URL = 'http://127.0.0.1:3000';
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

// ─── UTILS ─────────────────────────────────────────────────────────────

async function apiCall(method, endpoint, body = null) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`\n========================================`);
  console.log(`[HTTP ${method}] ${url}`);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return JSON.parse(text);
  } catch (err) {
    console.error(`ERROR in ${method} ${endpoint}:`, err.message);
    process.exit(1);
  }
}

/** 
 * Low-level XDR signer to avoid "Bad union switch" bug in stellar-sdk@13
 */
function signXdrRaw(unsignedXdrBase64, secretKey) {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const raw = Buffer.from(unsignedXdrBase64, 'base64');

  const envelopeTypeValue = raw.readUInt32BE(0);
  const sigCount = raw.readUInt32BE(raw.length - 4);
  const txBodyBytes = raw.subarray(4, raw.length - 4);

  const networkId = StellarSdk.hash(Buffer.from(NETWORK_PASSPHRASE));
  const typeTag = Buffer.alloc(4);
  typeTag.writeUInt32BE(envelopeTypeValue, 0);

  const hashPreimage = Buffer.concat([networkId, typeTag, txBodyBytes]);
  const txHash = StellarSdk.hash(hashPreimage);

  const signature = keypair.sign(txHash);
  const hint = keypair.signatureHint();

  const decoratedSig = Buffer.alloc(4 + 4 + 64);
  hint.copy(decoratedSig, 0);
  decoratedSig.writeUInt32BE(64, 4);
  signature.copy(decoratedSig, 8);

  const newSigCount = Buffer.alloc(4);
  newSigCount.writeUInt32BE(sigCount + 1, 0);

  let existingSigs = Buffer.alloc(0);
  if (sigCount > 0) {
    const existingSigsLength = sigCount * 72;
    existingSigs = raw.subarray(raw.length - 4 - existingSigsLength, raw.length - 4);
    const txEnd = raw.length - 4 - existingSigsLength;
    const signedEnvelope = Buffer.concat([
      raw.subarray(0, 4),
      raw.subarray(4, txEnd),
      newSigCount,
      existingSigs,
      decoratedSig,
    ]);
    return signedEnvelope.toString('base64');
  }

  const signedEnvelope = Buffer.concat([
    raw.subarray(0, 4),
    txBodyBytes,
    newSigCount,
    decoratedSig,
  ]);
  
  return signedEnvelope.toString('base64');
}

// ─── EXTRACT SECRETS ───────────────────────────────────────────────────
function loadSecrets() {
  const yamlPath = path.resolve(__dirname, '../accounts.yaml');
  const content = fs.readFileSync(yamlPath, 'utf-8');
  
  // Buyer is the issuer-account (GDVCLTCROXEKHTHST5JY5HEILNN4GDIDBXAJBZNOSGJ36PXMLZI7625W)
  const buyerMatch = content.match(/issuer-account:[\s\S]*?secret-key:\s*(S[A-Z0-9]+)/);
  // Seller is the sender-account (GDZMFMC7FHN7PLXNA7Q5YJYKYLXC7ZOMS7BLP4LWLESPCX4IKP3WKUGH)
  const sellerMatch = content.match(/sender-account:[\s\S]*?secret-key:\s*(S[A-Z0-9]+)/);
  
  if (!buyerMatch || !sellerMatch) throw new Error("Could not parse keys from accounts.yaml");
  
  return {
    BUYER_SECRET: buyerMatch[1],
    SELLER_SECRET: sellerMatch[1]
  };
}

// ─── MAIN E2E FLOW ─────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  const { BUYER_SECRET, SELLER_SECRET } = loadSecrets();
  
  const buyerKeys = StellarSdk.Keypair.fromSecret(BUYER_SECRET);
  const sellerKeys = StellarSdk.Keypair.fromSecret(SELLER_SECRET);

  console.log(`\n🔑 Keys loaded!\nBuyer: ${buyerKeys.publicKey()}\nSeller: ${sellerKeys.publicKey()}`);

  try {
    // -------------------------------------------------------------
    // 0. SEED THE ORDER
    // -------------------------------------------------------------
    console.log(`\n[0] Creating new Order in Database...`);
    let seller = await prisma.appUser.findFirst({ where: { alias: 'dummySeller' } });
    let buyer = await prisma.appUser.findFirst({ where: { alias: 'dummyBuyer' } });
    let offer = await prisma.offer.findFirst();

    const order = await prisma.order.create({
      data: {
        offerId: offer.offerId,
        buyerId: buyer.userId,
        sellerId: seller.userId,
        assetAmount: 2.5,
        fiatAmount: 2.5,
      }
    });
    console.log(`=> Created Order: ${order.orderId}`);

    // -------------------------------------------------------------
    // 1. OPEN ESCROW
    // -------------------------------------------------------------
    const openRes = await apiCall('POST', '/escrows/open', {
      orderId: order.orderId,
      sellerAddress: sellerKeys.publicKey(),
      buyerAddress: buyerKeys.publicKey(),
      amount: 2.5,
      title: "E2E Test Order"
    });
    const escrowId = openRes.escrowId;
    console.log(`=> Escrow Initialized (Backend deployed SC!)\n=> unsignedFundXdr received.`);

    // -------------------------------------------------------------
    // 2. FUND ESCROW
    // -------------------------------------------------------------
    console.log(`\n[2] Seller signs FUND transaction...`);
    const signedFundXdr = signXdrRaw(openRes.unsignedFundTransaction, SELLER_SECRET);
    
    console.log(`=> Syncing FUND transaction...`);
    const syncFundRes = await apiCall('POST', '/escrows/sync', {
      escrowId,
      action: 'fund',
      signedXdr: signedFundXdr
    });
    console.log(`=> FUND Sync Success. Status: ${syncFundRes.newEscrowStatus}`);

    // -------------------------------------------------------------
    // 3. FIAT SENT (Evidence upload by Buyer)
    // -------------------------------------------------------------
    console.log(`\n[3] Buyer marks Fiat Sent & gets XDR...`);
    const fiatSentRes = await apiCall('POST', `/escrows/${escrowId}/fiat-sent`, {
      buyerAddress: buyerKeys.publicKey(),
      evidence: "Test Evidence E2E"
    });

    console.log(`=> Buyer signs FIAT_SENT transaction...`);
    const signedFiatSentXdr = signXdrRaw(fiatSentRes.unsignedTransaction, BUYER_SECRET);

    console.log(`=> Syncing FIAT_SENT transaction...`);
    const syncFiatRes = await apiCall('POST', '/escrows/sync', {
      escrowId,
      action: 'fiat_sent',
      signedXdr: signedFiatSentXdr
    });
    console.log(`=> FIAT_SENT Sync Success.`);

    console.log(`\n[WAIT] Allowing 10 seconds for TW Indexer to detect state change...`);
    await new Promise(r => setTimeout(r, 10000));

    const statusAfterFiat = await apiCall('GET', `/escrows/${escrowId}/status`);
    console.log(`=> Status after Fiat Sent:`);
    console.dir(statusAfterFiat.onChainData?.[0]?.milestones?.[0], {depth: null});

    // -------------------------------------------------------------
    // 4. RELEASE (Seller verifies and releases)
    // -------------------------------------------------------------
    console.log(`\n[4] Seller gets Release XDR...`);
    const releaseRes = await apiCall('POST', '/escrows/release', {
      escrowId,
      releaseSigner: sellerKeys.publicKey()
    });

    console.log(`=> Seller signs RELEASE transaction...`);
    const signedReleaseXdr = signXdrRaw(releaseRes.unsignedTransaction, SELLER_SECRET);

    console.log(`=> Syncing RELEASE transaction...`);
    const syncReleaseRes = await apiCall('POST', '/escrows/sync', {
      escrowId,
      action: 'release',
      signedXdr: signedReleaseXdr
    });
    console.log(`=> RELEASE Sync Success. State finalized!`);

    // -------------------------------------------------------------
    // 5. VERIFY FINAL STATUS
    // -------------------------------------------------------------
    const finalStatus = await apiCall('GET', `/escrows/${escrowId}/status`);
    console.log(`\n========================================`);
    console.log(`🔥 E2E TEST PASSED! Final Status: ${finalStatus.escrowStatus}`);
    console.log(`Contract balance: ${finalStatus.onChainBalance[0].balance}`);
    console.log(`========================================\n`);

  } catch (e) {
    console.error(`\n❌ E2E TEST FAILED: ${e.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
