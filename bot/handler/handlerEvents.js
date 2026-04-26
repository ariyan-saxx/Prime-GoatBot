const fs = require("fs-extra");
const path = require("path");

const nullAndUndefined = [undefined, null];
const getType = obj => Object.prototype.toString.call(obj).slice(8, -1);

const getRole = (threadData, senderID) => {
    const adminBot = global.GoatBot.config.adminBot || [];
    if (!senderID) return 0;
    const adminBox = threadData?.adminIDs || [];
    return adminBot.includes(senderID) ? 2 : adminBox.includes(senderID) ? 1 : 0;
};

const getText = (type, reason, time, targetID, lang) => {
    const { utils } = global;
    const heads = { lang, head: "handlerEvents" };
    const templates = {
        userBanned: () => utils.getText(heads, "userBanned", reason, time, targetID),
        threadBanned: () => utils.getText(heads, "threadBanned", reason, time, targetID),
        onlyAdminBox: () => utils.getText(heads, "onlyAdminBox"),
        onlyAdminBot: () => utils.getText(heads, "onlyAdminBot")
    };
    return templates[type]?.() || "";
};

module.exports = (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) => {
    return async function (event, message) {
        const { utils, client, GoatBot } = global;
        const { threadID, body, isGroup, messageID } = event;
        if (!threadID) return;

        const senderID = event.userID || event.senderID || event.author;

        let threadData = global.db.allThreadData.find(t => t.threadID == threadID) || await threadsData.create(threadID);
        let userData = global.db.allUserData.find(u => u.userID == senderID) || await usersData.create(senderID);

        const prefix = utils.getPrefix(threadID);
        const role = getRole(threadData, senderID);
        const langCode = threadData?.data?.lang || GoatBot.config.language || "en";

        const baseParams = { 
            api, usersData, threadsData, message, event, 
            prefix, role, langCode, globalData, 
            envCommands: GoatBot.configCommands.envCommands 
        };

        async function onStart() {
            if (!body || !body.startsWith(prefix)) return;
            const args = body.slice(prefix.length).trim().split(/ +/);
            let commandName = args.shift().toLowerCase();
            let command = GoatBot.commands.get(commandName) || GoatBot.commands.get(GoatBot.aliases.get(commandName));

            if (!command && threadData?.data?.aliases) {
                const aliasKey = Object.keys(threadData.data.aliases).find(key => threadData.data.aliases[key].includes(commandName));
                if (aliasKey) command = GoatBot.commands.get(aliasKey);
            }

            if (!command) return !GoatBot.config.hideNotiMessage.commandNotFound && message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound", commandName, prefix));

            commandName = command.config.name;
            if (userData?.banned?.status || (isGroup && threadData?.banned?.status)) {
                const banObj = userData?.banned?.status ? userData.banned : threadData.banned;
                return !GoatBot.config.hideNotiMessage[userData?.banned?.status ? "userBanned" : "threadBanned"] && message.reply(getText(userData?.banned?.status ? "userBanned" : "threadBanned", banObj.reason, banObj.date, userData?.banned?.status ? senderID : threadID, langCode));
            }

            const roleNeeded = (typeof command.config.role === 'object' ? command.config.role.onStart : command.config.role) || 0;
            if (roleNeeded > role) return message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, roleNeeded === 1 ? "onlyAdmin" : "onlyAdminBot2", commandName));

            if (!client.countDown[commandName]) client.countDown[commandName] = {};
            const cooldown = (command.config.countDown || 1) * 1000;
            if (client.countDown[commandName][senderID] && Date.now() < client.countDown[commandName][senderID] + cooldown) {
                return message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "waitingForCommand", ((client.countDown[commandName][senderID] + cooldown - Date.now()) / 1000).toFixed(1)));
            }

            try {
                await command.onStart({ ...baseParams, args, commandName });
                client.countDown[commandName][senderID] = Date.now();
            } catch (err) { utils.log.err("CMD_EXE", err); }
        }

        async function onReply() {
            if (!event.messageReply) return;
            const replyObj = GoatBot.onReply.get(event.messageReply.messageID);
            if (!replyObj) return;
            const command = GoatBot.commands.get(replyObj.commandName);
            if (command) {
                try { await command.onReply({ ...baseParams, Reply: replyObj, commandName: replyObj.commandName }); } 
                catch (err) { utils.log.err("REPLY_EXE", err); }
            }
        }

        async function onReaction() {
            const reactObj = GoatBot.onReaction.get(messageID);
            if (!reactObj) return;
            const command = GoatBot.commands.get(reactObj.commandName);
            if (command) {
                try { await command.onReaction({ ...baseParams, Reaction: reactObj, commandName: reactObj.commandName }); } 
                catch (err) { utils.log.err("REACT_EXE", err); }
            }
        }

        async function onChat() {
            for (const [name, command] of GoatBot.commands) {
                if (command.onChat) {
                    try { await command.onChat({ ...baseParams, commandName: name }); } 
                    catch (err) { }
                }
            }
        }

        return { onStart, onChat, onReply, onReaction, onAnyEvent: async () => {}, onFirstChat: async () => {}, onEvent: async () => {}, handlerEvent: async () => {}, typ: async () => {}, presence: async () => {}, read_receipt: async () => {} };
    };
};
