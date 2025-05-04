const { Client, GatewayIntentBits, PermissionsBitField, Events } = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const JOIN_TO_CREATE_CHANNEL_ID = '1368350565678977105'; // Replace with your actual channel ID
const createdChannels = new Map();
const vcBans = new Map();

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member;

  // === Create VC ===
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

      const text = `${member}, VC created.\n> \`.vc kick @user\`\n> \`.vc ban @user\`\n> \`.vc unban @user\`\n> \`.vc lock\`\n> \`.vc unlock\``;
      const textChannel = guild.channels.cache.find(ch => ch.name === 'cmds' && ch.isTextBased());
      if (textChannel) textChannel.send(text);

      console.log(`VC created for ${member.user.tag}`);
    } catch (err) {
      console.error('Error creating VC:', err);
    }
  }

  // === Delete Empty VC ===
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

client.on(Events.MessageCreate, async (message) => {
  if (!message.content.startsWith('.vc') || message.author.bot) return;

  const [command, action, mention] = message.content.split(' ');

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel || !createdChannels.has(voiceChannel.id)) return;

  const ownerId = createdChannels.get(voiceChannel.id);
  if (message.author.id !== ownerId) return message.reply('Only the VC owner can use these commands.');

  const target = message.mentions.members.first();
  if ((['kick', 'ban', 'unban'].includes(action)) && !target) {
    return message.reply('Please mention a user.');
  }

  switch (action) {
    case 'kick':
      if (target.voice.channelId === voiceChannel.id) {
        await target.voice.disconnect();
        message.reply(`${target.user.tag} was kicked.`);
      } else {
        message.reply(`${target.user.tag} is not in your VC.`);
      }
      break;

    case 'ban':
      if (!vcBans.has(voiceChannel.id)) vcBans.set(voiceChannel.id, new Set());
      vcBans.get(voiceChannel.id).add(target.id);

      await voiceChannel.permissionOverwrites.edit(target.id, {
        Connect: false,
      });
      if (target.voice.channelId === voiceChannel.id) {
        await target.voice.disconnect();
      }
      message.reply(`${target.user.tag} was banned.`);
      break;

    case 'unban':
      if (vcBans.has(voiceChannel.id)) {
        vcBans.get(voiceChannel.id).delete(target.id);
      }

      await voiceChannel.permissionOverwrites.delete(target.id);
      message.reply(`${target.user.tag} was unbanned.`);
      break;

    case 'lock':
      await voiceChannel.permissionOverwrites.edit(message.guild.id, {
        Connect: false,
      });
      message.reply('VC locked.');
      break;

    case 'unlock':
      await voiceChannel.permissionOverwrites.edit(message.guild.id, {
        Connect: null,
      });
      message.reply('VC unlocked.');
      break;

    default:
      message.reply('Unknown command.');
  }
});

client.login(process.env.DISCORD_TOKEN);
