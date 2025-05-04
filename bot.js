require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, Events } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const JOIN_TO_CREATE_CHANNEL_ID = '1368350565678977105'; // replace this
const createdChannels = new Map();
const bannedUsers = new Map();

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member;

    // User joined the Join-to-Create VC
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
                        allow: [PermissionsBitField.Flags.Connect],
                    },
                    {
                        id: guild.roles.everyone,
                        allow: [PermissionsBitField.Flags.Connect],
                    }
                ],
            });

            createdChannels.set(newChannel.id, member.id);
            await member.voice.setChannel(newChannel);

            // Lock the VC chat for everyone except bot
            const vcChat = guild.channels.cache.find(ch =>
                ch.name === newChannel.name && ch.isTextBased()
            );

            if (vcChat) {
                await vcChat.permissionOverwrites.edit(guild.roles.everyone, {
                    SendMessages: false,
                });

                await vcChat.permissionOverwrites.edit(client.user.id, {
                    SendMessages: true,
                    ViewChannel: true,
                });

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

    // Delete empty VC
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

client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    const userVoiceChannel = message.member.voice.channel;
    if (!userVoiceChannel) return;

    const ownerId = createdChannels.get(userVoiceChannel.id);
    if (!ownerId || message.member.id !== ownerId) return;

    if (command === '.vc') {
        const subcommand = args.shift()?.toLowerCase();

        const target = message.mentions.members.first();
        if (!target && ['kick', 'ban', 'unban'].includes(subcommand)) {
            return message.reply('Please mention a user.');
        }

        switch (subcommand) {
            case 'kick':
                if (target.voice.channel?.id === userVoiceChannel.id) {
                    target.voice.disconnect().catch(() => {});
                    message.reply(`${target.user.tag} was kicked.`);
                } else {
                    message.reply(`${target.user.tag} is not in your VC.`);
                }
                break;

            case 'ban':
                bannedUsers.set(`${userVoiceChannel.id}_${target.id}`, true);
                if (target.voice.channel?.id === userVoiceChannel.id) {
                    target.voice.disconnect().catch(() => {});
                }
                await userVoiceChannel.permissionOverwrites.edit(target.id, {
                    Connect: false,
                });
                message.reply(`${target.user.tag} was banned.`);
                break;

            case 'unban':
                bannedUsers.delete(`${userVoiceChannel.id}_${target.id}`);
                await userVoiceChannel.permissionOverwrites.delete(target.id);
                message.reply(`${target.user.tag} was unbanned.`);
                break;

            case 'lock':
                await userVoiceChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    Connect: false,
                });
                message.reply('VC locked.');
                break;

            case 'unlock':
                await userVoiceChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    Connect: true,
                });
                message.reply('VC unlocked.');
                break;
        }
    }
});

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN);
