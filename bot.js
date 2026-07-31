require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites
    ]
});

// **Environment Variables**
const TOKEN = process.env.TOKEN;
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const GUILD_ID = process.env.GUILD_ID;
const SUBSCRIPTIONS_CHANNEL_ID = process.env.SUBSCRIPTIONS_CHANNEL_ID;

// **Role IDs**
const ROLES = {
    Silver: process.env.SILVER_ROLE_ID,
    Gold: process.env.GOLD_ROLE_ID,
    Platinum: process.env.PLATINUM_ROLE_ID,
    Elite: process.env.ELITE_ROLE_ID
};

// **Tier Definitions**
const TIERS = [
    { name: 'Silver', roleId: ROLES.Silver, monthlyPrice: 40, lifetimePrice: 3499 },
    { name: 'Gold', roleId: ROLES.Gold, monthlyPrice: 55, lifetimePrice: 7999 },
    { name: 'Platinum', roleId: ROLES.Platinum, monthlyPrice: 70, lifetimePrice: 11999 },
    { name: 'Elite', roleId: ROLES.Elite, monthlyPrice: 125, lifetimePrice: 16860 }
];

// **Tier Order for Upgrades**
const TIER_ORDER = ['Silver', 'Gold', 'Platinum', 'Elite'];

// Store invites in memory
let inviteCache = new Map();

// **Validate Environment Variables**
if (
    !TOKEN ||
    !NOWPAYMENTS_API_KEY ||
    !GUILD_ID ||
    !SUBSCRIPTIONS_CHANNEL_ID ||
    Object.values(ROLES).some(roleId => !roleId)
) {
    console.error('Missing required environment variables. Check your .env file.');
    process.exit(1);
}

// **Helper Functions**

// Send response via DM or fallback to channel
async function sendResponse(interactionOrMessage, content) {
    const target = interactionOrMessage.user || interactionOrMessage.author;
    try {
        await target.send(content);
    } catch (error) {
        console.error('Error sending DM:', error);
        const channel = interactionOrMessage.channel;
        await channel.send(`<@${target.id}>, I couldn’t send you a DM. Check your privacy settings.`);
    }
}

// Get active subscription for a user
async function getActiveSubscription(userId) {
    const subscriptions = await loadSubscriptions();
    const now = Date.now();
    return subscriptions.find(sub =>
        sub.userId === userId &&
        (sub.isLifetime || sub.expirationTime > now)
    ) || null;
}

// Load subscriptions from file
async function loadSubscriptions() {
    try {
        const data = await fs.readFile('role_expirations.json', 'utf-8');
        return data.trim() ? JSON.parse(data) : [];
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile('role_expirations.json', '[]');
            return [];
        }
        console.error('Error loading subscriptions:', error);
        return [];
    }
}

// Save subscriptions to file
async function saveSubscriptions(subscriptions) {
    await fs.writeFile('role_expirations.json', JSON.stringify(subscriptions, null, 2));
}

// Load free trials from file
async function loadFreeTrials() {
    try {
        const data = await fs.readFile('free_trials.json', 'utf-8');
        return data.trim() ? JSON.parse(data) : [];
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.writeFile('free_trials.json', '[]');
            return [];
        }
        console.error('Error loading free trials:', error);
        return [];
    }
}

// Save free trials to file
async function saveFreeTrials(freeTrials) {
    await fs.writeFile('free_trials.json', JSON.stringify(freeTrials, null, 2));
}

// Check and manage expired roles
async function checkExpiredRoles() {
    const subscriptions = await loadSubscriptions();
    const now = Date.now();
    const oneDayFromNow = now + 24 * 60 * 60 * 1000;
    const guild = await client.guilds.fetch(GUILD_ID);

    for (const sub of subscriptions) {
        if (!sub.isLifetime && sub.expirationTime <= now) {
            try {
                const member = await guild.members.fetch(sub.userId);
                await member.roles.remove(sub.roleId);
            } catch (error) {
                console.error(`Failed to remove role ${sub.roleId} from ${sub.userId}:`, error);
            }
        } else if (!sub.isLifetime && sub.expirationTime <= oneDayFromNow) {
            try {
                const user = await client.users.fetch(sub.userId);
                const role = guild.roles.cache.get(sub.roleId);
                await user.send(`Your ${role.name} subscription expires in < 24 hours. Renew to continue!`);
            } catch (error) {
                console.error(`Failed to notify ${sub.userId}:`, error);
            }
        }
    }

    const activeSubs = subscriptions.filter(sub => sub.isLifetime || sub.expirationTime > now);
    await saveSubscriptions(activeSubs);
}

// **Bot Startup**
client.once('ready', async () => {
    console.log('Bot is online!');

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.members.fetch();
        console.log('Successfully cached all guild members');
    } catch (error) {
        console.error('Error fetching guild members:', error);
    }

    try {
        await client.application.commands.create({
            name: 'sb-show-status',
            description: 'Show subscription status for a user',
            options: [{
                name: 'username',
                description: 'Username to check',
                type: 3,
                required: true
            }],
            defaultMemberPermissions: '8'
        });
        console.log('Slash command registered successfully');
    } catch (error) {
        console.error('Error registering slash command:', error);
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const invites = await guild.invites.fetch();
        invites.each(invite => inviteCache.set(invite.code, invite.uses));
        console.log('Invite cache initialized');
    } catch (error) {
        console.error('Error caching invites:', error);
    }

    const channel = await client.channels.fetch(SUBSCRIPTIONS_CHANNEL_ID);
    const startButton = new ButtonBuilder()
        .setCustomId('start_subscription')
        .setLabel('Start Subscription Process')
        .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(startButton);
    await channel.send({ content: 'Click to begin the subscription process:', components: [row] });
    await checkExpiredRoles();
});

// **Interaction Handler**
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'start_subscription') {
        await interaction.deferReply({ flags: 64 });

        const fullMessageParts = [
            `🚀 **Secure Your Access & Maximize Savings!**\nTo subscribe, select your desired tier and subscription duration using the buttons below.\nYou will receive a direct message from the subscription bot—please follow the steps provided.\n\n------------------------------------\n\n✅ **After completing your payment**, copy the Payment ID and use the command:\n\`!verify <Payment ID>\`\nin your chat with the Discord bot to verify your payment.\nYour role will be assigned automatically after successful verification!`,
            `💡 **Turn Your Subscription Into a Profit-Generating Asset!**\n\nYou're not just subscribing to ATS—you’re unlocking a powerful edge in the markets. Start at any level, prove its worth for yourself, and upgrade whenever you're ready.\n\nNow, think big: The potential profits you generate using ATS could far exceed the cost of even the highest-tier plan. Many traders find that their gains effectively pay for the service, making it a zero-cost investment in their success.\n\nAt the end of the day, the question isn’t “Can I afford ATS?”—it’s “Can I afford to trade without it?” 🚀`,
            `------------------------------------\n\n⚠️ **Important: Subscription & Payment Terms**\n\nAll payments for Paid Services are final and non-refundable, except as required by law.\nMisuse of ATS (Advanced Trader Signals), such as fraud or spam, will result in account removal, suspension, or other necessary actions.\nBy confirming your subscription, you allow ATS to charge you for future payments in accordance with their terms.\nYou can cancel at any time, however, a minimum of 72 hours' notice is required.\nManage your subscription through the platform you subscribed on.\n\n🚫 **Unauthorized rebroadcasting, leaking, or sharing of alerts, signals, or related data is strictly prohibited.**\nThis includes distributing signals to non-subscribers, trading groups, online communities, or commercial entities.\nViolations may result in immediate termination of service without refund and legal repercussions.\n\n📜 For the full Signal Distribution & Intellectual Property Protection Policy, refer to the Policies section.`,
            `------------------------------------\n\n🔹 **Silver Tier – All Individual Scanner Alerts**\n💳 **Pricing & Subscription Plans**: (Secure the best rate by subscribing for a longer period!)\n\n**Silver Tier Pricing:**\n| Duration            | Price  |\n|---------------------|--------|\n| Monthly (1 month)   | $40    |\n| Quarterly (3 months)| $120   |\n| Semi-Annual (6 months)| $240 |\n| Annual (1 × 12 months)| $480 |\n| Biennial (2 × 12 months)| $960 |\n| Lifetime (one-time payment)| $3,499 |\n\n✨ **Features:**\n✅ All Individual Scanner Alerts for precision-based trading insights: DVMC – Daily Volume vs. Market Cap, FVG – Fair Value Gaps, OB – Order Blocks, S&D – Supply & Demand Zones, Consol – Consolidation Zones, T-Shift – Trend Shifts, Liq – Liquidations, Vol Prof – Volume Profiles`,
            `------------------------------------\n\n🔸 **Gold Tier – AI-Powered Trade Insights**\n💳 **Pricing & Subscription Plans**: (Lock in today’s pricing before increases take effect!)\n\n**Gold Tier Pricing:**\n| Duration            | Price  |\n|---------------------|--------|\n| Monthly (1 month)   | $55    |\n| Quarterly (3 months)| $165   |\n| Semi-Annual (6 months)| $330 |\n| Annual (1 × 12 months)| $660 |\n| Biennial (2 × 12 months)| $1,320 |\n| Lifetime (one-time payment)| $7,999 |\n\n✨ **Features:**\n✅ Everything in Silver Tier\n✅ AI-Powered Trade Summaries – AI-driven insights for high-probability trade setups`,
            `------------------------------------\n\n🚀 **Platinum Tier & Elite Tier Access!**\n\n**Platinum Tier Pricing:**\n| Duration            | Price  |\n|---------------------|--------|\n| Monthly (1 month)   | $70    |\n| Quarterly (3 months)| $210   |\n| Semi-Annual (6 months)| $420 |\n| Annual (1 × 12 months)| $840 |\n| Biennial (2 × 12 months)| $1,680 |\n| Lifetime (one-time payment)| $11,999 |\n\n**Elite Tier Pricing:**\n| Duration            | Price  |\n|---------------------|--------|\n| Monthly (1 month)   | $125   |\n| Quarterly (3 months)| $375   |\n| Semi-Annual (6 months)| $750 |\n| Annual (1 × 12 months)| $1,500 |\n| Biennial (2 × 12 months)| $3,000 |\n| Lifetime (one-time payment)| $16,860 |\n\n✨ **Features:**\nPlatinum: Everything in Silver & Gold Tiers, AI-Driven Combined Alerts\nElite: Everything in Platinum, plus Automated Trading & Lifetime Perks`,
            `------------------------------------\n\n🔒 **Lock In Your Rate & Save!**\nWe strive to keep costs low while improving our services. As we add more tools and features, prices may rise. Subscribing long-term locks in today’s rates!\n\n**Cost Comparison (6 Years):**\n| Category          | Silver  | Gold   | Platinum | Elite  |\n|-------------------|---------|--------|----------|--------|\n| Total Cost (6 Yr) | $7,920  | $12,060| $16,560  | $22,860|\n| Saving Lifetime   | $4,421  | $4,061 | $4,561   | $6,000 |\n\n**Please confirm you have read and agree to the above terms by clicking below.**`
        ];

        try {
            for (const part of fullMessageParts) {
                await interaction.user.send(part);
            }
            const confirmButton = new ButtonBuilder()
                .setCustomId('confirm_policies')
                .setLabel('Clicking Confirms Above')
                .setStyle(ButtonStyle.Primary);
            const row = new ActionRowBuilder().addComponents(confirmButton);
            await interaction.user.send({ content: '**Click to confirm:**', components: [row] });
            await interaction.editReply({ content: 'Subscription details sent to your DMs.' });
        } catch (dmError) {
            console.error('Error sending DM:', dmError);
            await interaction.editReply({ content: 'I couldn’t send you a DM. Check your privacy settings.' });
        }
    }

    else if (interaction.customId === 'confirm_policies') {
        await interaction.deferReply({ flags: 64 });
        const activeSub = await getActiveSubscription(interaction.user.id);
        const currentTierIndex = activeSub ? TIER_ORDER.indexOf(TIERS.find(t => t.roleId === activeSub.roleId).name) : -1;

        const subscriptionButtons = TIERS.map(tier =>
            new ButtonBuilder()
                .setCustomId(`select_${tier.name.toLowerCase()}`)
                .setLabel(`${tier.name} Tier`)
                .setStyle(ButtonStyle.Primary)
        );

        const upgradeButtons = [];
        if (currentTierIndex >= 0 && currentTierIndex < TIER_ORDER.length - 1) {
            for (let i = currentTierIndex + 1; i < TIER_ORDER.length; i++) {
                const nextTier = TIERS[i];
                upgradeButtons.push(
                    new ButtonBuilder()
                        .setCustomId(`upgrade_${nextTier.name.toLowerCase()}`)
                        .setLabel(`Upgrade to ${nextTier.name}`)
                        .setStyle(ButtonStyle.Success)
                );
            }
        }

        const freeTrials = await loadFreeTrials();
        const hasClaimedFreeTrial = freeTrials.includes(interaction.user.id);
        const hasActiveSub = activeSub !== null;

        const rows = [];
        let allButtons = [...subscriptionButtons, ...upgradeButtons];

        if (!hasClaimedFreeTrial && !hasActiveSub) {
            const freeTrialButton = new ButtonBuilder()
                .setCustomId('claim_free_trial')
                .setLabel('Claim 2-Week Free Trial (Platinum)')
                .setStyle(ButtonStyle.Primary);
            allButtons.push(freeTrialButton);
        }

        for (let i = 0; i < allButtons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(allButtons.slice(i, i + 5)));
        }

        await interaction.editReply({ content: 'Choose your tier or upgrade:', components: rows });
    }

    else if (interaction.customId === 'claim_free_trial') {
        await interaction.deferReply({ flags: 64 });

        const freeTrials = await loadFreeTrials();
        if (freeTrials.includes(interaction.user.id)) {
            await interaction.editReply({ content: 'You have already claimed your free trial.' });
            return;
        }

        const activeSub = await getActiveSubscription(interaction.user.id);
        if (activeSub) {
            await interaction.editReply({ content: 'You already have an active subscription.' });
            return;
        }

        const platinumTier = TIERS.find(t => t.name === 'Platinum');
        const expirationTime = Date.now() + 14 * 24 * 60 * 60 * 1000; // 2 weeks from now

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(interaction.user.id);
        await member.roles.add(platinumTier.roleId);

        let subscriptions = await loadSubscriptions();
        subscriptions.push({
            userId: interaction.user.id,
            roleId: platinumTier.roleId,
            expirationTime: expirationTime,
            isLifetime: false
        });
        await saveSubscriptions(subscriptions);

        freeTrials.push(interaction.user.id);
        await saveFreeTrials(freeTrials);

        await interaction.editReply({ content: 'You have successfully claimed your 2-week free trial for the Platinum tier! Enjoy your access.' });
    }

    else if (interaction.customId.startsWith('select_')) {
        await interaction.deferReply({ flags: 64 });
        const tierName = interaction.customId.split('_')[1];
        const tier = TIERS.find(t => t.name.toLowerCase() === tierName);
        const buttons = [
            { id: '1', label: '1 Month' },
            { id: '3', label: '3 Months' },
            { id: '6', label: '6 Months' },
            { id: '12', label: '12 Months' },
            { id: '24', label: '24 Months' },
            { id: 'lifetime', label: 'Lifetime' }
        ].map(d =>
            new ButtonBuilder()
                .setCustomId(`${tierName}_${d.id}`)
                .setLabel(d.label)
                .setStyle(ButtonStyle.Secondary)
        );

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        await interaction.editReply({ content: `Choose duration for ${tier.name}:`, components: rows });
    }

    else if (interaction.customId.startsWith('upgrade_')) {
        await interaction.deferReply({ flags: 64 });
        const targetTierName = interaction.customId.split('_')[1];
        const targetTier = TIERS.find(t => t.name.toLowerCase() === targetTierName);
        const activeSub = await getActiveSubscription(interaction.user.id);

        if (!activeSub) {
            await interaction.editReply({ content: 'No active subscription to upgrade.' });
            return;
        }

        const currentTier = TIERS.find(t => t.roleId === activeSub.roleId);
        let upgradeCost;

        if (activeSub.isLifetime) {
            upgradeCost = targetTier.lifetimePrice - currentTier.lifetimePrice;
        } else {
            const remainingMs = activeSub.expirationTime - Date.now();
            const remainingDays = Math.max(Math.ceil(remainingMs / (1000 * 60 * 60 * 24)), 1);
            const currentDailyPrice = currentTier.monthlyPrice / 30;
            const targetDailyPrice = targetTier.monthlyPrice / 30;
            upgradeCost = (targetDailyPrice - currentDailyPrice) * remainingDays;
        }

        const orderId = `upgrade_${currentTier.name.toLowerCase()}_to_${targetTier.name.toLowerCase()}_${interaction.user.id}`;
        const paymentLink = await createPaymentLink(upgradeCost, orderId, `Upgrade to ${targetTier.name}`);
        await sendResponse(interaction,
            `Upgrade to ${targetTier.name}: $${upgradeCost.toFixed(2)}\n${paymentLink}\nUse \`!verify <paymentId>\` after payment.`
        );
        await interaction.editReply({ content: 'Upgrade payment link sent to DMs.' });
    }

    else if (interaction.customId.includes('_')) {
        await interaction.deferReply({ flags: 64 });
        const [tierName, duration] = interaction.customId.split('_');
        const tier = TIERS.find(t => t.name.toLowerCase() === tierName);
        const isLifetime = duration === 'lifetime';
        const months = isLifetime ? 0 : parseInt(duration);
        const amount = isLifetime ? tier.lifetimePrice : tier.monthlyPrice * months;
        const orderId = `${tierName}_${duration}_${interaction.user.id}`;
        const paymentLink = await createPaymentLink(amount, orderId, `${tier.name} for ${isLifetime ? 'Lifetime' : `${months} months`}`);
        await sendResponse(interaction,
            `Payment link for ${tier.name} (${isLifetime ? 'Lifetime' : `${months} month${months > 1 ? 's' : ''}`}): $${amount}\n${paymentLink}\nUse \`!verify <paymentId>\` after payment.`
        );
        await interaction.editReply({ content: 'Payment link sent to DMs.' });
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'sb-show-status') {
        if (!interaction.inGuild() || !interaction.member) {
            return interaction.reply({
                content: 'This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({
                content: 'This command is only for administrators.',
                flags: MessageFlags.Ephemeral
            });
        }

        const username = interaction.options.getString('username');
        const member = interaction.guild.members.cache.find(m => m.user.username === username);

        if (!member) {
            return interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        }

        let inviteInfo = 'No invite data found';
        try {
            const inviteData = await fs.readFile('invite_tracking.json', 'utf-8');
            const inviteHistory = JSON.parse(inviteData);
            const userInvite = inviteHistory.find(invite => invite.userId === member.id);
            if (userInvite) {
                const inviter = userInvite.inviter ? (await client.users.fetch(userInvite.inviter)).username : 'Unknown';
                inviteInfo = `Invited by: ${inviter}\nInvite code: ${userInvite.inviteCode}\nJoined: ${new Date(userInvite.joinedAt).toUTCString()}`;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error reading invite data:', error);
            }
        }

        const subscription = await getActiveSubscription(member.id);
        let subscriptionInfo = 'No active subscription found';

        if (subscription) {
            const tier = TIERS.find(t => t.roleId === subscription.roleId);
            subscriptionInfo = `Tier: ${tier.name}\n` +
                `Type: ${subscription.isLifetime ? 'Lifetime' : 'Time-limited'}\n` +
                (subscription.isLifetime ? '' : `Expires: ${new Date(subscription.expirationTime).toUTCString()}`);
        }

        const response = `Status for ${username}:\n\n` +
            `Subscription Information:\n${subscriptionInfo}\n\n` +
            `Invite Information:\n${inviteInfo}`;

        return interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
    }
});

// Track invite usage
client.on('guildMemberAdd', async member => {
    if (member.guild.id !== GUILD_ID) return;

    try {
        const newInvites = await member.guild.invites.fetch();
        const usedInvite = newInvites.find(invite => inviteCache.get(invite.code) < invite.uses);

        if (usedInvite) {
            inviteCache.set(usedInvite.code, usedInvite.uses);
            const inviteData = {
                userId: member.id,
                username: member.user.username,
                inviteCode: usedInvite.code,
                inviter: usedInvite.inviter?.id,
                joinedAt: new Date().toISOString()
            };

            let inviteHistory = [];
            try {
                const data = await fs.readFile('invite_tracking.json', 'utf-8');
                inviteHistory = JSON.parse(data);
            } catch (error) {
                if (error.code !== 'ENOENT') console.error('Error loading invite history:', error);
            }

            inviteHistory.push(inviteData);
            await fs.writeFile('invite_tracking.json', JSON.stringify(inviteHistory, null, 2));
            console.log(`Tracked invite usage: ${member.user.username} joined using invite ${usedInvite.code}`);
        }
    } catch (error) {
        console.error('Error tracking invite:', error);
    }
});

// Invite link tracking
client.on('inviteCreate', invite => {
    inviteCache.set(invite.code, invite.uses);
    console.log(`New invite created: ${invite.code}`);
});

client.on('inviteDelete', invite => {
    inviteCache.delete(invite.code);
    console.log(`Invite deleted: ${invite.code}`);
});

// **Create Payment Link**
async function createPaymentLink(amount, orderId, description) {
    try {
        const response = await axios.post('https://api.nowpayments.io/v1/invoice', {
            price_amount: amount,
            price_currency: 'usd',
            order_id: orderId,
            order_description: description
        }, { headers: { 'x-api-key': NOWPAYMENTS_API_KEY } });
        return response.data.invoice_url;
    } catch (error) {
        console.error('Error creating payment link:', error.response ? error.response.data : error.message);
        throw new Error('Failed to create payment link');
    }
}

// **Handle Verification Command**
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!verify') || message.author.bot) return;
    const paymentId = message.content.split(' ')[1];
    if (!paymentId) {
        await sendResponse(message, 'Usage: `!verify <paymentId>`');
        return;
    }

    const usedPaymentsPath = 'used_payments.json';
    let usedPayments = [];
    try {
        const data = await fs.readFile(usedPaymentsPath, 'utf-8');
        usedPayments = data.trim() ? JSON.parse(data) : [];
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Error loading used payments:', error);
    }

    if (usedPayments.includes(paymentId)) {
        await sendResponse(message, 'This payment ID has already been used.');
        return;
    }

    try {
        const paymentData = await axios.get(`https://api.nowpayments.io/v1/payment/${paymentId}`, {
            headers: { 'x-api-key': NOWPAYMENTS_API_KEY }
        }).then(res => res.data);

        if (['finished', 'confirmed', 'partially_paid'].includes(paymentData.payment_status)) {
            const parts = paymentData.order_id.split('_');
            let type = parts[0];
            let userId = parts[parts.length - 1];
            let tierName, duration, fromTier, toTier;

            if (type === 'upgrade') {
                [fromTier, , toTier] = parts.slice(1, -1);
            } else {
                tierName = type;
                duration = parts[1];
            }

            if (userId !== message.author.id) {
                await sendResponse(message, 'This payment isn’t linked to your account.');
                return;
            }

            const guild = await client.guilds.fetch(GUILD_ID);
            const member = await guild.members.fetch(message.author.id);
            let subscriptions = await loadSubscriptions();

            if (type === 'upgrade') {
                const from = TIERS.find(t => t.name.toLowerCase() === fromTier);
                const to = TIERS.find(t => t.name.toLowerCase() === toTier);
                const subIndex = subscriptions.findIndex(s => s.userId === userId && s.roleId === from.roleId);
                if (subIndex === -1) {
                    await sendResponse(message, 'No active subscription to upgrade.');
                    return;
                }
                subscriptions[subIndex].roleId = to.roleId;
                await member.roles.remove(from.roleId);
                await member.roles.add(to.roleId);
                await sendResponse(message, `Upgraded to ${to.name} until ${new Date(subscriptions[subIndex].expirationTime).toUTCString()}`);
            } else {
                const tier = TIERS.find(t => t.name.toLowerCase() === tierName);
                const isLifetime = duration === 'lifetime';
                const months = isLifetime ? 0 : parseInt(duration);
                const expirationTime = isLifetime ? null : Date.now() + months * 30 * 24 * 60 * 60 * 1000;
                const existingSub = subscriptions.find(s => s.userId === userId && s.roleId === tier.roleId);

                if (existingSub && !existingSub.isLifetime) {
                    existingSub.expirationTime += months * 30 * 24 * 60 * 60 * 1000;
                    await sendResponse(message, `${tier.name} extended by ${months} month${months > 1 ? 's' : ''}. New expiration: ${new Date(existingSub.expirationTime).toUTCString()}`);
                } else {
                    subscriptions.push({
                        userId,
                        roleId: tier.roleId,
                        expirationTime,
                        isLifetime
                    });
                    await member.roles.add(tier.roleId);
                    await sendResponse(message, `${tier.name} assigned for ${isLifetime ? 'lifetime' : `${months} month${months > 1 ? 's' : ''}`}. ${isLifetime ? '' : `Expires: ${new Date(expirationTime).toUTCString()}`}`);
                }
            }

            await saveSubscriptions(subscriptions);
            usedPayments.push(paymentId);
            await fs.writeFile(usedPaymentsPath, JSON.stringify(usedPayments, null, 2));
        } else {
            await sendResponse(message, 'Payment not confirmed yet. Please wait.');
        }
    } catch (error) {
        console.error('Verification error:', error);
        await sendResponse(message, 'Error verifying payment. Please try again or contact support.');
    }
});

// **Periodic Role Check**
setInterval(checkExpiredRoles, 60 * 60 * 1000);

// **Login**
client.login(TOKEN);
