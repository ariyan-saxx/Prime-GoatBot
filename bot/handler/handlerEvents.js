const fs = require("fs-extra");
const nullAndUndefined = [undefined, null];
const schedule = require('node-schedule');
const axios = require('axios');

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
    if (type == "userBanned") return utils.getText({ lang, head: "handlerEvents" }, "userBanned", reason, time, targetID);
    else if (type == "threadBanned") return utils.getText({ lang, head: "handlerEvents" }, "threadBanned", reason, time, targetID);
    else if (type == "onlyAdminBox") return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBox");
    else if (type == "onlyAdminBot") return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBot");
}

function addXP(userID, amount) {
    let user = global.db.allUserData.find(u => u.userID === userID);
    user.XP = (user.XP || 0) + amount;
    if (user.XP >= getNextLevel(user.level)) {
        user.level += 1;
        message.reply(`Congratulations! You've leveled up to level ${user.level}!`);
    }
}

function replaceShortcutInLang(text, prefix, commandName) {
    return text.replace(/\{(?:p|prefix)\}/g, prefix).replace(/\{(?:n|name)\}/g, commandName).replace(/\{pn\}/g, `${prefix}${commandName}`);
}

function getRoleConfig(utils, command, isGroup, threadData, commandName) {
    let roleConfig;
    if (utils.isNumber(command.config.role)) {
        roleConfig = { onStart: command.config.role };
    } else if (typeof command.config.role == "object" && !Array.isArray(command.config.role)) {
        if (!command.config.role.onStart) command.config.role.onStart = 0;
        roleConfig = command.config.role;
    } else {
        roleConfig = { onStart: 0 };
    }
    if (isGroup) roleConfig.onStart = threadData.data.setRole?.[commandName] ?? roleConfig.onStart;
    for (const key of ["onChat", "onStart", "onReaction", "onReply"]) {
        if (roleConfig[key] == undefined) roleConfig[key] = roleConfig.onStart;
    }
    return roleConfig;
}

function isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, lang) {
    const config = global.GoatBot.config;
    const { adminBot, hideNotiMessage } = config;

    if (userData.banned?.status) {
        const { reason, date } = userData.banned;
        if (!hideNotiMessage.userBanned) message.reply(getText("userBanned", reason, date, senderID, lang));
        return true;
    }

    if (config.adminOnly.enable && !adminBot.includes(senderID) && !config.adminOnly.ignoreCommand.includes(commandName)) {
        if (!hideNotiMessage.adminOnly) message.reply(getText("onlyAdminBot", null, null, null, lang));
        return true;
    }

    if (isGroup) {
        if (threadData.data.onlyAdminBox && !threadData.adminIDs.includes(senderID) && !(threadData.data.ignoreCommanToOnlyAdminBox || []).includes(commandName)) {
            if (!threadData.data.hideNotiMessageOnlyAdminBox) message.reply(getText("onlyAdminBox", null, null, null, lang));
            return true;
        }
        if (threadData.banned?.status) {
            const { reason, date } = threadData.banned;
            if (!hideNotiMessage.threadBanned) message.reply(getText("threadBanned", reason, date, threadID, lang));
            return true;
        }
    }
    return false;
}

function createGetText2(langCode, pathCustomLang, prefix, command) {
    const commandType = command.config.countDown ? "command" : "command event";
    const commandName = command.config.name;
    let customLang = {};
    let getText2 = () => {};
    if (fs.existsSync(pathCustomLang)) customLang = require(pathCustomLang)[commandName]?.text || {};
    if (command.langs || customLang) {
        getText2 = function (key, ...args) {
            let lang = command.langs?.[langCode]?.[key] || customLang[key] || "";
            lang = replaceShortcutInLang(lang, prefix, commandName);
            for (let i = args.length - 1; i >= 0; i--) lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
            return lang || `❌ Can't find text on language "${langCode}" for ${commandType} "${commandName}" with key "${key}"`;
        };
    }
    return getText2;
}

function logPermissionAttempt(commandName, senderID) {
    console.log(`User ${senderID} attempted to use command "${commandName}" without necessary permissions.`);
}

function loadCommands(commandsDir) {
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    commandFiles.forEach(file => {
        const command = require(path.join(commandsDir, file));
        GoatBot.commands.set(command.config.name, command);
    });
}

async function fetchWeather(location) {
    const response = await axios.get(`https://api.weatherapi.com/v1/current.json?key=YOUR_API_KEY&q=${location}`);
    return response.data.current;
}

module.exports = function (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) {
    return async function (event, message) {
        const { utils, client, GoatBot } = global;
        const { getPrefix, removeHomeDir, log, getTime } = utils;
        const { config, configCommands: { envGlobal, envCommands, envEvents } } = GoatBot;
        const { autoRefreshThreadInfoFirstTime } = config.database;
        let { hideNotiMessage = {} } = config;

        const { body, messageID, threadID, isGroup } = event;
        if (!threadID) return;

        const senderID = event.userID || event.senderID || event.author;
        let threadData = global.db.allThreadData.find(t => t.threadID == threadID);
        let userData = global.db.allUserData.find(u => u.userID == senderID);

        if (!userData && !isNaN(senderID)) userData = await usersData.create(senderID);
        if (!threadData && !isNaN(threadID)) {
            if (global.temp.createThreadDataError.includes(threadID)) return;
            threadData = await threadsData.create(threadID);
            global.db.receivedTheFirstMessage[threadID] = true;
        } else {
            if (autoRefreshThreadInfoFirstTime && !global.db.receivedTheFirstMessage[threadID]) {
                global.db.receivedTheFirstMessage[threadID] = true;
                await threadsData.refreshInfo(threadID);
            }
        }

        if (typeof threadData.settings.hideNotiMessage == "object") hideNotiMessage = threadData.settings.hideNotiMessage;
        const prefix = getPrefix(threadID);
        const role = getRole(threadData, senderID);
        const parameters = { api, usersData, threadsData, message, event, userModel, threadModel, prefix, dashBoardModel, globalModel, dashBoardData, globalData, envCommands, envEvents, envGlobal, role };
        const langCode = threadData.data.lang || config.language || "en";

        async function onStart() {
            if (!body || !body.startsWith(prefix)) return;
            const args = body.slice(prefix.length).trim().split(/ +/);
            let commandName = args.shift().toLowerCase();
            let command = GoatBot.commands.get(commandName) || GoatBot.commands.get(GoatBot.aliases.get(commandName));
            const aliasesData = threadData.data.aliases || {};

            for (const cmdName in aliasesData) {
                if (aliasesData[cmdName].includes(commandName)) {
                    command = GoatBot.commands.get(cmdName);
                    break;
                }
            }
            if (command) commandName = command.config.name;

            if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode)) return;
            if (!command) {
                if (!hideNotiMessage.commandNotFound) await message.reply(commandName ? utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound", commandName, prefix) : utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound2", prefix));
                return;
            }
            const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
            const needRole = roleConfig.onStart;
            if (needRole > role) {
                if (!hideNotiMessage.needRoleToUseCmd) {
                    if (needRole == 1) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdmin", commandName));
                    else if (needRole == 2) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminBot2", commandName));
                } else return true;
            }
            const dateNow = Date.now();
            const cooldownCommand = (command.config.countDown || 1) * 1000;
            if (client.countDown[commandName]?.[senderID]) {
                const expirationTime = client.countDown[commandName][senderID] + cooldownCommand;
                if (dateNow < expirationTime) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "waitingForCommand", ((expirationTime - dateNow) / 1000).toString().slice(0, 3)));
            }
            try {
                await command.onStart({ ...parameters, args, commandName, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) });
                client.countDown[commandName][senderID] = dateNow;
                log.info("CALL COMMAND", `${commandName} | ${userData.name} | ${senderID} | ${threadID} | ${args.join(" ")}`);
            } catch (err) {
                log.err("CALL COMMAND", `An error occurred when calling the command ${commandName}`, err);
                await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred", getTime("DD/MM/YYYY HH:mm:ss"), commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
            }
        }

        async function onChat() {
            const allOnChat = GoatBot.onChat || [];
            const args = body ? body.split(/ +/) : [];
            for (const key of allOnChat) {
                const command = GoatBot.commands.get(key);
                if (!command) continue;
                const commandName = command.config.name;
                const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
                const needRole = roleConfig.onChat;
                if (needRole > role) continue;
                try {
                    await command.onChat({ ...parameters, args, commandName, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) });
                } catch (err) {
                    log.err("onChat", `An error occurred when calling the command onChat ${commandName}`, err);
                }
            }
        }

        async function onReply() {
            if (!event.messageReply) return;
            const Reply = GoatBot.onReply.get(event.messageReply.messageID);
            if (!Reply) return;
            const commandName = Reply.commandName;
            const command = GoatBot.commands.get(commandName);
            if (!command) return message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "cannotFindCommand", commandName));
            const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
            const needRole = roleConfig.onReply;
            if (needRole > role) {
                if (!hideNotiMessage.needRoleToUseCmdOnReply) {
                    if (needRole == 1) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminToUseOnReply", commandName));
                    else if (needRole == 2) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminBot2ToUseOnReply", commandName));
                } else return true;
            }
            try {
                await command.onReply({ ...parameters, Reply, args: [], commandName, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) });
            } catch (err) {
                log.err("onReply", `An error occurred when calling the command onReply ${commandName}`, err);
                await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred3", getTime("DD/MM/YYYY HH:mm:ss"), commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
            }
        }

        async function onReaction() {
            const Reaction = GoatBot.onReaction.get(messageID);
            if (!Reaction) return;
            const commandName = Reaction.commandName;
            const command = GoatBot.commands.get(commandName);
            if (!command) return message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "cannotFindCommand", commandName));
            const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
            const needRole = roleConfig.onReaction;
            if (needRole > role) {
                if (!hideNotiMessage.needRoleToUseCmdOnReaction) {
                    if (needRole == 1) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminToUseOnReaction", commandName));
                    else if (needRole == 2) return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminBot2ToUseOnReaction", commandName));
                } else return true;
            }
            try {
                await command.onReaction({ ...parameters, Reaction, args: [], commandName, getLang: createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command) });
            } catch (err) {
                log.err("onReaction", `An error occurred when calling the command onReaction ${commandName}`, err);
                await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred4", getTime("DD/MM/YYYY HH:mm:ss"), commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
            }
        }

        return {
            onStart,
            onChat,
            onReply,
            onReaction
        };
    };
};
