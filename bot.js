require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const JOIN_TO_CREATE_CHANNEL_ID = '1368350565678977105'; // Replace with your actual VC ID
const createdChannels = new Map();
const vcOwners = new Map(); // Track who owns which VC
const bannedUsers = new Map(); // Map<channelId, Set<userId>>

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member;

  // User joined the join-to-create VC
  if (newState.channelId === JOIN_TO_CREATE_CHANNEL_ID) {
    if ([...createdChannels.values()].includes(member.id)) return;

    const guild = newState.guild;
    const category = newState.channel.parent;

    try {
      const newChannel = await guild.channels.create({
        name: `@${member.user.username.toLowerCase()} vc`,
        type: ChannelType.GuildVoice,
        parent: category ?? undefined,
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
      vcOwners.set(member.id, newChannel.id);
      bannedUsers.set(newChannel.id, new Set());

      await member.voice.setChannel(newChannel);

      // Optional instruction message
      const text = `${member} created a VC: <#${newChannel.id}>\n> \`.vc kick @user\`\n> \`.vc ban @user\`\n> \`.vc unban @user\`\n> \`.vc lock\`\n> \`.vc unlock\``;
      const textChannel = guild.channels.cache.find(ch => ch.name === 'cmds' && ch.isTextBased());
      if (textChannel) textChannel.send(text);

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
      const ownerId = [...vcOwners.entries()].find(([_, cid]) => cid === oldState.channelId)?.[0];
      if (ownerId) vcOwners.delete(ownerId);
      bannedUsers.delete(oldState.channelId);
    } catch (err) {
      console.error('Error deleting VC:', err);
    }
  }
});

// Message commands
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('.vc')) return;
  if (message.channel.name !== 'cmds') return;

  const args = message.content.split(' ');
  const command = args[1];
  const target = message.mentions.members.first();
  const ownerVcId = vcOwners.get(message.author.id);
  const vc = client.channels.cache.get(ownerVcId);

  if (!vc || vc.type !== ChannelType.GuildVoice) {
    return message.reply("You don't own a VC.");
  }

  if (command === 'kick' && target) {
    if (vc.members.has(target.id)) {
      await target.voice.disconnect();
      return message.reply(`Kicked ${target.user.tag} from your VC.`);
    } else {
      return message.reply("That user is not in your VC.");
    }
  }

  if (command === 'ban' && target) {
    bannedUsers.get(vc.id)?.add(target.id);
    await vc.permissionOverwrites.edit(target.id, {
      Connect: false,
    });
    if (vc.members.has(target.id)) {
      await target.voice.disconnect();
    }
    return message.reply(`Banned ${target.user.tag} from your VC.`);
  }

  if (command === 'unban' && target) {
    bannedUsers.get(vc.id)?.delete(target.id);
    await vc.permissionOverwrites.delete(target.id);
    return message.reply(`Unbanned ${target.user.tag} from your VC.`);
  }

  if (command === 'lock') {
    await vc.permissionOverwrites.edit(vc.guild.id, {
      Connect: false,
    });
    return message.reply("Your VC is now locked.");
  }

  if (command === 'unlock') {
    await vc.permissionOverwrites.edit(vc.guild.id, {
      Connect: null,
    });
    return message.reply("Your VC is now unlocked.");
  }

});

client.login(process.env.DISCORD_TOKEN);
