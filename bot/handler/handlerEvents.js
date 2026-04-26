const fs = require("fs-extra");
const nullAndUndefined = [undefined, null];

function getType(obj) {
    return Object.prototype.toString.call(obj).slice(8, -1);
}

function getRole(threadData, senderID) {
    const adminBot = global.GoatBot.config.adminBot || [];
    if (!senderID) return 0;
    const adminBox = threadData ? threadData.adminIDs || [] : [];
    return adminBot.includes(senderID) ? 2 : adminBox.includes(senderID) ? 1 : 0;
}

function getText(type, reason, time, targetID, lang) {
    const utils = global.utils;
    const heads = { lang, head: "handlerEvents" };
    if (type == "userBanned") return utils.getText(heads, "userBanned", reason, time, targetID);
    if (type == "threadBanned") return utils.getText(heads, "threadBanned", reason, time, targetID);
    if (type == "onlyAdminBox") return utils.getText(heads, "onlyAdminBox");
    if (type == "onlyAdminBot") return utils.getText(heads, "onlyAdminBot");
}

function replaceShortcutInLang(text, prefix, commandName) {
    return text
        .replace(/\{(?:p|prefix)\}/g, prefix)
        .replace(/\{(?:n|name)\}/g, commandName)
        .replace(/\{pn\}/g, `${prefix}${commandName}`);
}

function getRoleConfig(utils, command, isGroup, threadData, commandName) {
    let roleConfig = utils.isNumber(command.config.role) ? { onStart: command.config.role } : (typeof command.config.role == "object" && !Array.isArray(command.config.role) ? command.config.role : { onStart: 0 });
    if (!roleConfig.onStart) roleConfig.onStart = 0;
    if (isGroup) roleConfig.onStart = threadData.data.setRole?.[commandName] ?? roleConfig.onStart;
    for (const key of ["onChat", "onStart", "onReaction", "onReply"]) {
        if (roleConfig[key] == undefined) roleConfig[key] = roleConfig.onStart;
    }
    return roleConfig;
}

function isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, lang) {
    const config = global.GoatBot.config;
    const { adminBot, hideNotiMessage } = config;

    if (userData.banned.status == true) {
        if (hideNotiMessage.userBanned == false) message.reply(getText("userBanned", userData.banned.reason, userData.banned.date, senderID, lang));
        return true;
    }

    if (config.adminOnly.enable == true && !adminBot.includes(senderID) && !config.adminOnly.ignoreCommand.includes(commandName)) {
        if (hideNotiMessage.adminOnly == false) message.reply(getText("onlyAdminBot", null, null, null, lang));
        return true;
    }

    if (isGroup == true) {
        if (threadData.data.onlyAdminBox === true && !threadData.adminIDs.includes(senderID) && !(threadData.data.ignoreCommanToOnlyAdminBox || []).includes(commandName)) {
            if (!threadData.data.hideNotiMessageOnlyAdminBox) message.reply(getText("onlyAdminBox", null, null, null, lang));
            return true;
        }
        if (threadData.banned.status == true) {
            if (hideNotiMessage.threadBanned == false) message.reply(getText("threadBanned", threadData.banned.reason, threadData.banned.date, threadID, lang));
            return true;
        }
    }
    return false;
}

function createGetText2(langCode, pathCustomLang, prefix, command) {
    const commandName = command.config.name;
    let customLang = fs.existsSync(pathCustomLang) ? require(pathCustomLang)[commandName]?.text || {} : {};
    return function (key, ...args) {
        let lang = command.langs?.[langCode]?.[key] || customLang[key] || "";
        lang = replaceShortcutInLang(lang, prefix, commandName);
        for (let i = args.length - 1; i >= 0; i--) lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
        return lang || `❌ Missing text for "${key}" in ${commandName}`;
    };
}

module.exports = function (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) {
    return async function (event, message) {
        const { utils, client, GoatBot } = global;
        const { getPrefix, removeHomeDir, log, getTime } = utils;
        const { config, configCommands: { envGlobal, envCommands, envEvents } } = GoatBot;
        const { body, messageID, threadID, isGroup } = event;

        if (!threadID) return;
        const senderID = event.userID || event.senderID || event.author;

        let threadData = global.db.allThreadData.find(t => t.threadID == threadID) || await threadsData.create(threadID);
        let userData = global.db.allUserData.find(u => u.userID == senderID) || await usersData.create(senderID);

        const prefix = getPrefix(threadID);
        const role = getRole(threadData, senderID);
        const langCode = threadData.data.lang || config.language || "en";

        const parameters = {
            api, usersData, threadsData, message, event, userModel, threadModel, prefix, dashBoardModel,
            globalModel, dashBoardData, globalData, envCommands, envEvents, envGlobal, role,
            removeCommandNameFromBody: (b, p, c) => b.replace(new RegExp(`^${p}(\\s+|)${c}`, "i"), "").trim()
        };

        // —————————————————————————————————————————————— //
        //                     HANDLERS                   //
        // —————————————————————————————————————————————— //

        async function onStart() {
            if (!body || !body.startsWith(prefix)) return;
            const args = body.slice(prefix.length).trim().split(/ +/);
            let commandName = args.shift().toLowerCase();
            let command = GoatBot.commands.get(commandName) || GoatBot.commands.get(GoatBot.aliases.get(commandName));

            if (!command && threadData.data.aliases) {
                for (const cmdName in threadData.data.aliases) {
                    if (threadData.data.aliases[cmdName].includes(commandName)) {
                        command = GoatBot.commands.get(cmdName);
                        break;
                    }
                }
            }

            if (!command) return !config.hideNotiMessage.commandNotFound && message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound", commandName, prefix));

            commandName = command.config.name;
            if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode)) return;

            const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
            if (roleConfig.onStart > role) return message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, roleConfig.onStart == 1 ? "onlyAdmin" : "onlyAdminBot2", commandName));

            if (!client.countDown[commandName]) client.countDown[commandName] = {};
            const cooldown = (command.config.countDown || 1) * 1000;
            if (client.countDown[commandName][senderID] && Date.now() < client.countDown[commandName][senderID] + cooldown) {
                return message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "waitingForCommand", ((client.countDown[commandName][senderID] + cooldown - Date.now()) / 1000).toFixed(1)));
            }

            try {
                const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
                await command.onStart({ ...parameters, args, commandName, getLang: getText2 });
                client.countDown[commandName][senderID] = Date.now();
                log.info("COMMAND", `${commandName} | ${senderID} | ${threadID}`);
            } catch (err) {
                log.err("COMMAND_ERR", err);
                message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred", getTime(), commandName, err.stack));
            }
        }

        async function onChat() {
            for (const key of (GoatBot.onChat || [])) {
                const command = GoatBot.commands.get(key);
                if (!command || getRoleConfig(utils, command, isGroup, threadData, command.config.name).onChat > role) continue;
                try {
                    await command.onChat({ ...parameters, commandName: command.config.name });
                } catch (e) { log.err("ON_CHAT_ERR", e); }
            }
        }

        async function onReply() {
            if (!event.messageReply) return;
            const reply = GoatBot.onReply.get(event.messageReply.messageID);
            if (!reply) return;
            const command = GoatBot.commands.get(reply.commandName);
            if (!command || getRoleConfig(utils, command, isGroup, threadData, reply.commandName).onReply > role) return;
            try {
                await command.onReply({ ...parameters, Reply: reply, commandName: reply.commandName });
            } catch (e) { log.err("ON_REPLY_ERR", e); }
        }

        async function onReaction() {
            const reaction = GoatBot.onReaction.get(messageID);
            if (!reaction) return;
            const command = GoatBot.commands.get(reaction.commandName);
            if (!command || getRoleConfig(utils, command, isGroup, threadData, reaction.commandName).onReaction > role) return;
            try {
                await command.onReaction({ ...parameters, Reaction: reaction, commandName: reaction.commandName });
            } catch (e) { log.err("ON_REACT_ERR", e); }
        }

        async function handlerEvent() {
            for (const [key, getEvent] of GoatBot.eventCommands.entries()) {
                try {
                    const handler = await getEvent.onStart({ ...parameters, commandName: getEvent.config.name });
                    if (typeof handler == "function") await handler();
                } catch (e) { log.err("EVENT_ERR", e); }
            }
        }

        async function onEvent() {
            for (const key of (GoatBot.onEvent || [])) {
                const command = GoatBot.commands.get(key);
                if (command) try { await command.onEvent({ ...parameters, commandName: command.config.name }); } catch (e) {}
            }
        }

        return { onStart, onChat, onReply, onReaction, onAnyEvent: async () => {}, onFirstChat: async () => {}, onEvent, handlerEvent, typ: async () => {}, presence: async () => {}, read_receipt: async () => {} };
    };
};
