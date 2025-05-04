require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const JOIN_TO_CREATE_CHANNEL_ID = '1368350565678977105'; // <-- replace this with your join-to-create VC channel ID
const createdChannels = new Map();
const voiceBans = new Set();

// === BOT READY ===
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// === VOICE STATE UPDATE ===
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;

    // Prevent banned users from joining auto-generated VCs
    if (voiceBans.has(member.id)) {
        if (newState.channel && createdChannels.has(newState.channel.id)) {
            await member.voice.disconnect();
            console.log(`${member.user.tag} tried to join but is voice banned.`);
            return;
        }
    }

    // Join-to-create logic
    if (newState.channelId === JOIN_TO_CREATE_CHANNEL_ID) {
        if ([...createdChannels.values()].includes(member.id)) return;

        const guild = newState.guild;
        const category = newState.channel.parent;

        try {
            const newChannel = await guild.channels.create({
                name: `@${member.user.username.toLowerCase()} vc`,
                type: 2,
                parent: category?.id ?? null,
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ManageChannels],
                    },
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.Connect],
                    },
                ],
            });

            createdChannels.set(newChannel.id, member.id);
            await member.voice.setChannel(newChannel);

            // Send instructions
            const text = `${member} created a vc.\n> \`.vc kick @user\`\n> \`.vc ban @user\`\n> \`.vc unban @user\`\n> \`.vc lock\`\n> \`.vc unlock\``;
            const textChannel = newChannel.guild.channels.cache.find(ch => ch.name === 'cmds' && ch.isTextBased());
            if (textChannel) textChannel.send(text);

            console.log(`VC created for ${member.user.tag}`);
        } catch (err) {
            console.error('Error creating VC:', err);
        }
    }

    // Delete empty channel
    if (
        oldState.channelId &&
        createdChannels.has(oldState.channelId) &&
        oldState.channel.members.size === 0
    ) {
        try {
            await oldState.channel.delete();
            createdChannels.delete(oldState.channelId);
            console.log(`Deleted empty VC: ${oldState.channel.name}`);
        } catch (err) {
            console.error('Error deleting VC:', err);
        }
    }
});

// === COMMAND HANDLER ===
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('.vc') || message.author.bot) return;

    const args = message.content.trim().split(/ +/);
    const action = args[1];
    const member = message.mentions.members?.first();
    const userVC = message.member.voice?.channel;
    const ownsVC = userVC && createdChannels.get(userVC.id) === message.author.id;

    if (['kick', 'ban', 'unban', 'lock', 'unlock'].includes(action) && !ownsVC) {
        return message.reply("You don't own the VC or you're not in one.");
    }

    if (action === 'kick') {
        if (!member) return message.reply('Mention a user like `.vc kick @user`');
        if (member.voice.channel?.id !== userVC.id) return message.reply("That user isn't in your VC.");
        await member.voice.disconnect();
        message.channel.send(`${member.user.username} was kicked from your VC.`);

    } else if (action === 'ban') {
        if (!member) return message.reply('Mention a user like `.vc ban @user`');
        voiceBans.add(member.id);
        if (member.voice.channel?.id === userVC.id) await member.voice.disconnect();
        message.channel.send(`${member.user.username} was voice banned from your VC.`);

    } else if (action === 'unban') {
        if (!member) return message.reply('Mention a user like `.vc unban @user`');
        if (voiceBans.delete(member.id)) {
            message.channel.send(`${member.user.username} was unbanned from voice.`);
        } else {
            message.channel.send(`${member.user.username} is not banned.`);
        }

    } else if (action === 'lock') {
        await userVC.permissionOverwrites.edit(userVC.guild.id, {
            Connect: false
        });
        message.reply("Voice channel locked.");

    } else if (action === 'unlock') {
        await userVC.permissionOverwrites.edit(userVC.guild.id, {
            Connect: true
        });
        message.reply("Voice channel unlocked.");

    } else {
        message.reply('Invalid command. Use `.vc kick`, `.vc ban`, `.vc unban`, `.vc lock`, or `.vc unlock`.');
    }
});

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN);