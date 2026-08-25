import 'dotenv/config';
import http from 'http';
import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { Keypair, Connection, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { uploadTokenMetadata } from './pinata.js';
import { createPumpFunToken } from './pumpfun.js';

const { TELEGRAM_BOT_TOKEN, SOLANA_PRIVATE_KEY, SOLANA_RPC_URL, ALLOWED_TELEGRAM_IDS } =
  process.env;

if (!TELEGRAM_BOT_TOKEN || !SOLANA_PRIVATE_KEY || !SOLANA_RPC_URL) {
  throw new Error('Missing required environment variables. Set them in Render\'s Environment settings.');
}

const allowList = (ALLOWED_TELEGRAM_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function isAllowed(ctx) {
  if (allowList.length === 0) return true;
  return allowList.includes(String(ctx.from.id));
}

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const creatorKeypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));

// --- Bundling and Dumping Logic ---
const BUNDLING_AMOUNT = 0.01; // Default amount to bundle
const DUMPING_AMOUNT = 0.01; // Default amount to dump

// Function to get random wallet addresses (replace with your list of wallets)
function getRandomWallets(count) {
  const wallets = [
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
    'C8qjX1v7D7q6JqDp5z9Z67v7K6Qw6z3g7T7qjX1v7',
  ];
  return wallets.slice(0, count);
}

// --- Launch Wizard --- (same as before)
const launchWizard = new Scenes.WizardScene(
  'launch-wizard',
  async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('You are not authorized to launch tokens with this bot.');
      return ctx.scene.leave();
    }
    ctx.wizard.state.data = {};
    await ctx.reply("Let's launch a coin. What's the token name?");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.data.name = ctx.message.text.trim().slice(0, 32);
    await ctx.reply('Symbol / ticker (e.g. DOGE, max 10 characters)?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.data.symbol = ctx.message.text.trim().toUpperCase().slice(0, 10);
    await ctx.reply('Short description for the token?');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.data.description = ctx.message.text.trim();
    await ctx.reply('Now send the token image as a photo.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.photo) {
      await ctx.reply('Please send an image as a photo (not a file).');
      return;
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await fetch(link.href);
    ctx.wizard.state.data.imageBuffer = Buffer.from(await res.arrayBuffer());
    ctx.wizard.state.data.imageFilename = 'token.png';
    await ctx.reply('Dev buy in SOL at launch? Send a number (e.g. 0.1), or 0 to skip.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message?.text) return;
    const amount = parseFloat(ctx.message.text.trim());
    ctx.wizard.state.data.devBuySol = Number.isFinite(amount) && amount > 0 ? amount : 0;

    const { name, symbol, description, devBuySol } = ctx.wizard.state.data;
    await ctx.reply(
      `Confirm:\n` +
        `Name: ${name}\n` +
        `Symbol: ${symbol}\n` +
        `Description: ${description}\n` +
        `Dev buy: ${devBuySol} SOL\n\n` +
        `This submits a real on-chain transaction and spends real SOL from the bot's wallet. It can't be undone.`,
      Markup.inlineKeyboard([
        Markup.button.callback('Launch it', 'confirm_launch'),
        Markup.button.callback('Cancel', 'cancel_launch'),
      ])
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    await ctx.reply('Tap "Launch it" or "Cancel" above.');
  }
);

launchWizard.action('cancel_launch', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('Cancelled — no transaction was sent.');
  return ctx.scene.leave();
});

launchWizard.action('confirm_launch', async (ctx) => {
  await ctx.answerCbQuery();
  const { name, symbol, description, imageBuffer, imageFilename, devBuySol } =
    ctx.wizard.state.data;

  await ctx.editMessageText('Uploading metadata and submitting the transaction…');
  try {
    const mintKeypair = Keypair.generate();

    const uri = await uploadTokenMetadata({ imageBuffer, imageFilename, name, symbol, description });

    const { signature, mint } = await createPumpFunToken({
      connection,
      creatorKeypair,
      mintKeypair,
      name,
      symbol,
      uri,
      devBuySol,
    });

    await ctx.reply(`Launched.\npump.fun/${mint}\nhttps://solscan.io/tx/${signature}`);
  } catch (err) {
    console.error(err);
    await ctx.reply(`Launch failed: ${err.message}`);
  }
  return ctx.scene.leave();
});

const stage = new Scenes.Stage([launchWizard]);
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) => ctx.reply('Send /launch to create a new pump.fun token.'));
bot.command('launch', (ctx) => ctx.scene.enter('launch-wizard'));
bot.command('cancel', async (ctx) => {
  if (ctx.scene?.current) {
    await ctx.scene.leave();
    await ctx.reply('Cancelled.');
  }
});

bot.command('bundle', async (ctx) => {
  await ctx.scene.enter('bundle-wizard');
});

bot.command('dump', async (ctx) => {
  await ctx.scene.enter('dump-wizard');
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

bot.launch();
console.log('Bot is running.');

// Render's free Web Service tier requires an open HTTP port to consider the
// service "live" - this doesn't do anything for the bot itself, it's purely
// to satisfy that check.
const port = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot is running')).listen(port);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
bot.start((ctx) => ctx.reply('Send /launch to create a new pump.fun token.'));
bot.command('launch', (ctx) => ctx.scene.enter('launch-wizard'));
bot.command('cancel', async (ctx) => {
  if (ctx.scene?.current) {
    await ctx.scene.leave();
    await ctx.reply('Cancelled.');
  }
});
