const { Client, GatewayIntentBits, PermissionsBitField, Partials, ChannelType } = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const JOIN_TO_CREATE_CHANNEL_ID = '1368350565678977105'; // replace this
const createdChannels = new Map(); // VC_ID -> owner_ID
const vcBans = new Map(); // VC_ID -> Set of banned user IDs

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;

    // === VC CREATED ===
    if (newState.channelId === JOIN_TO_CREATE_CHANNEL_ID) {
        if ([...createdChannels.values()].includes(member.id)) return;

        const guild = newState.guild;
        const category = newState.channel.parent;

        try {
            const newChannel = await guild.channels.create({
                name: `@${member.user.username.toLowerCase()} vc`,
                type: ChannelType.GuildVoice,
                parent: category?.id ?? null,
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ManageChannels],
                    },
                    {
                        id: guild.id,
                        allow: [PermissionsBitField.Flags.Connect], // UNLOCKED by default
                    },
                ],
            });

            createdChannels.set(newChannel.id, member.id);
            vcBans.set(newChannel.id, new Set());
            await member.voice.setChannel(newChannel);

            // Send instructions message in VC's chat channel
            const vcChat = newChannel.guild.channels.cache.find(ch =>
                ch.name === newChannel.name && ch.isTextBased()
            );

            if (vcChat) {
                vcChat.send(
                    `${member} VC created.\n` +
                    '> `.vc kick @user`\n' +
                    '> `.vc ban @user`\n' +
                    '> `.vc unban @user`\n' +
                    '> `.vc lock`\n' +
                    '> `.vc unlock`'
                );
            }

            console.log(`VC created for ${member.user.tag}`);
        } catch (err) {
            console.error('Error creating VC:', err);
        }
    }

    // === VC DELETED IF EMPTY ===
    if (
        oldState.channelId &&
        createdChannels.has(oldState.channelId) &&
        oldState.channel.members.size === 0
    ) {
        try {
            await oldState.channel.delete();
            createdChannels.delete(oldState.channelId);
            vcBans.delete(oldState.channelId);
            console.log(`Deleted empty VC: ${oldState.channel.name}`);
        } catch (err) {
            console.error('Error deleting VC:', err);
        }
    }
});

// === COMMANDS HANDLER ===
client.on('messageCreate', async (msg) => {
    if (!msg.content.startsWith('.vc')) return;
    if (!msg.member?.voice?.channel) return;
    const vc = msg.member.voice.channel;
    const ownerId = createdChannels.get(vc.id);
    if (!ownerId || msg.author.id !== ownerId) {
        return msg.reply('You are not the owner of the VC.');
    }

    const args = msg.content.split(/\s+/);
    const command = args[1];
    const mentioned = msg.mentions.members.first();

    switch (command) {
        case 'kick':
            if (!mentioned) return msg.reply('Mention a user to kick.');
            if (mentioned.voice.channel?.id === vc.id) {
                mentioned.voice.disconnect().catch(() => msg.reply('Failed to disconnect user.'));
                msg.reply(`Kicked ${mentioned.user.tag}`);
            } else {
                msg.reply('User is not in your VC.');
            }
            break;

        case 'ban':
            if (!mentioned) return msg.reply('Mention a user to ban.');
            const bans = vcBans.get(vc.id);
            bans.add(mentioned.id);
            await vc.permissionOverwrites.edit(mentioned.id, { Connect: false });
            if (mentioned.voice.channel?.id === vc.id) {
                mentioned.voice.disconnect().catch(() => msg.reply('Failed to disconnect user.'));
            }
            msg.reply(`Banned ${mentioned.user.tag}`);
            break;

        case 'unban':
            if (!mentioned) return msg.reply('Mention a user to unban.');
            vcBans.get(vc.id).delete(mentioned.id);
            await vc.permissionOverwrites.delete(mentioned.id);
            msg.reply(`Unbanned ${mentioned.user.tag}`);
            break;

        case 'lock':
            await vc.permissionOverwrites.edit(vc.guild.id, { Connect: false });
            msg.reply('VC locked.');
            break;

        case 'unlock':
            await vc.permissionOverwrites.edit(vc.guild.id, { Connect: true });
            msg.reply('VC unlocked.');
            break;

        default:
            msg.reply('Unknown `.vc` command.');
    }
});

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN);
