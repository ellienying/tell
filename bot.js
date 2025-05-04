require('dotenv').config();
const { Client, GatewayIntentBits, Events, PermissionsBitField } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const JOIN_TO_CREATE_CHANNEL_ID = '1368350565678977105'; // Replace with your voice channel ID
const createdChannels = new Map();
const vcBans = new Map();

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member;

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

            const text = `${member}, VC created:\n.cmds\n.vc kick @user\n.vc ban @user\n.vc unban @user\n.vc lock\n.vc unlock`;
            const textChannel = newChannel.guild.channels.cache.find(ch => ch.name === 'cmds' && ch.isTextBased());
            if (textChannel) textChannel.send(text);

            console.log(`VC created for ${member.user.tag}`);
        } catch (err) {
            console.error('Error creating VC:', err);
        }
    }

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
    if (!message.content.startsWith('.vc') || message.author.bot) return;

    const [cmd, action, mention] = message.content.trim().split(/\s+/);
    const member = message.member;
    const voiceChannel = member.voice.channel;
    if (!voiceChannel || !createdChannels.has(voiceChannel.id)) {
        return message.reply("You're not in a VC that you created.");
    }

    const ownerId = createdChannels.get(voiceChannel.id);
    if (member.id !== ownerId) {
        return message.reply("Only the VC owner can use this command.");
    }

    const target = message.mentions.members.first();
    switch (action) {
        case 'kick':
            if (!target?.voice?.channel || target.voice.channel.id !== voiceChannel.id)
                return message.reply("That user isn't in your VC.");
            await target.voice.disconnect();
            message.reply(`Kicked ${target.user.tag} from the VC.`);
            break;

        case 'ban':
            if (!target) return message.reply("Mention someone to ban.");
            vcBans.set(`${voiceChannel.id}_${target.id}`, true);
            await voiceChannel.permissionOverwrites.edit(target.id, {
                Connect: false,
            });
            if (target.voice.channel?.id === voiceChannel.id)
                await target.voice.disconnect();
            message.reply(`Banned ${target.user.tag} from the VC.`);
            break;

        case 'unban':
            if (!target) return message.reply("Mention someone to unban.");
            vcBans.delete(`${voiceChannel.id}_${target.id}`);
            await voiceChannel.permissionOverwrites.delete(target.id);
            message.reply(`Unbanned ${target.user.tag} from the VC.`);
            break;

        case 'lock':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, {
                Connect: false,
            });
            message.reply("VC locked.");
            break;

        case 'unlock':
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, {
                Connect: null,
            });
            message.reply("VC unlocked.");
            break;

        default:
            message.reply("Unknown subcommand.");
    }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (
        newState.channelId &&
        vcBans.get(`${newState.channelId}_${newState.id}`)
    ) {
        newState.disconnect();
    }
});

client.login(process.env.DISCORD_TOKEN);
